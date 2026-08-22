import { and, desc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { customers, loyaltyAccounts, loyaltyLedger, orders } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { paginate, paginationQuerySchema, type Paginated } from "../validation/common";

/**
 * Loyalty module (feature: "loyalty") — earning only.
 *
 * Customers earn 1 point per major currency unit of an order's grand total
 * (floor(grandTotal / 100), money stays integer cents everywhere). Points
 * land in an append-only ledger; the account row carries the materialized
 * balance. Redemption at checkout is a documented later enhancement.
 */

// ── Schemas ──────────────────────────────────────────────────

/** Manual admin adjustment: non-zero delta plus a required reason. */
export const adjustLoyaltySchema = z
  .object({
    delta: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((v) => v !== 0, "Adjustment cannot be zero"),
    reason: z.string().trim().min(1, "Reason is required").max(500),
  })
  .strict();

export type AdjustLoyaltyInput = z.infer<typeof adjustLoyaltySchema>;

export const listLoyaltyAccountsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
});

export type ListLoyaltyAccountsQuery = z.infer<typeof listLoyaltyAccountsQuerySchema>;

// ── Types ────────────────────────────────────────────────────

export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;
export type LoyaltyLedgerEntry = typeof loyaltyLedger.$inferSelect;

export type LoyaltyLedgerItem = {
  id: string;
  orderId: string | null;
  delta: number;
  reason: string;
  createdAt: Date;
};

export type LoyaltyAccountView = {
  balance: number;
  ledger: Paginated<LoyaltyLedgerItem>;
};

export type AwardLoyaltyResult = {
  /** false when skipped: guest order, zero points, or already awarded. */
  awarded: boolean;
  points: number;
};

export type LoyaltyAccountListItem = {
  id: string;
  customerId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  balance: number;
  /** Bumped on every earn/adjustment. */
  lastActivityAt: Date;
  createdAt: Date;
};

export type LoyaltyAdminDetail = LoyaltyAccountView & {
  customer: { id: string; email: string; firstName: string | null; lastName: string | null };
};

/** Idempotency marker: one earn ledger row per order, ever. */
const orderEarnReason = (orderId: string) => `order:${orderId}`;

/** 1 point per major currency unit (grand total is integer cents). */
export function loyaltyPointsForTotal(grandTotalCents: number): number {
  return Math.floor(grandTotalCents / 100);
}

// ── Earning (called from the payment webhook) ────────────────

/**
 * Award points for a paid order. Idempotent: the webhook can fire twice —
 * an existing ledger row with reason `order:<orderId>` means already
 * awarded. Guest orders (no customerId) never earn. Creates the loyalty
 * account on first earn. Row-locked so a double webhook can't double-credit.
 */
export async function awardLoyaltyPoints(orderId: string): Promise<AwardLoyaltyResult> {
  const db = getDb();
  const order = await db.query.orders.findFirst({
    columns: { id: true, customerId: true, grandTotal: true },
    where: eq(orders.id, orderId),
  });
  if (!order) throw notFound("Order not found");
  if (!order.customerId) return { awarded: false, points: 0 };

  // Soft-deleted customers no longer earn.
  const customer = await db.query.customers.findFirst({
    columns: { id: true },
    where: and(eq(customers.id, order.customerId), isNull(customers.deletedAt)),
  });
  if (!customer) return { awarded: false, points: 0 };

  const points = loyaltyPointsForTotal(order.grandTotal);
  if (points <= 0) return { awarded: false, points: 0 };

  return db.transaction(async (tx) => {
    // Bootstrap the account on first earn, then lock it so concurrent
    // webhook deliveries serialize on the balance row.
    await tx.insert(loyaltyAccounts).values({ customerId: customer.id }).onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.customerId, customer.id))
      .for("update");
    if (!account) throw new Error("Loyalty account bootstrap failed");

    const [existing] = await tx
      .select({ id: loyaltyLedger.id })
      .from(loyaltyLedger)
      .where(
        and(eq(loyaltyLedger.accountId, account.id), eq(loyaltyLedger.reason, orderEarnReason(orderId))),
      )
      .limit(1);
    if (existing) return { awarded: false, points };

    await tx.insert(loyaltyLedger).values({
      accountId: account.id,
      orderId,
      delta: points,
      reason: orderEarnReason(orderId),
    });
    await tx
      .update(loyaltyAccounts)
      .set({ balance: account.balance + points, updatedAt: new Date() })
      .where(eq(loyaltyAccounts.id, account.id));

    return { awarded: true, points };
  });
}

// ── Customer view (public, authed) ───────────────────────────

/**
 * Balance + paginated ledger for the signed-in customer. A customer who
 * has never earned simply sees a zero balance — no account row created.
 */
export async function getLoyaltyAccount(
  customerId: string,
  query: { page: number; pageSize: number },
): Promise<LoyaltyAccountView> {
  const db = getDb();
  const account = await db.query.loyaltyAccounts.findFirst({
    where: eq(loyaltyAccounts.customerId, customerId),
  });
  if (!account) return { balance: 0, ledger: paginate([], query.page, query.pageSize, 0) };

  const where = eq(loyaltyLedger.accountId, account.id);
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(loyaltyLedger)
    .where(where);
  const rows = await db
    .select({
      id: loyaltyLedger.id,
      orderId: loyaltyLedger.orderId,
      delta: loyaltyLedger.delta,
      reason: loyaltyLedger.reason,
      createdAt: loyaltyLedger.createdAt,
    })
    .from(loyaltyLedger)
    .where(where)
    .orderBy(desc(loyaltyLedger.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { balance: account.balance, ledger: paginate(rows, query.page, query.pageSize, countRow?.total ?? 0) };
}

// ── Admin ────────────────────────────────────────────────────

export async function adminListLoyaltyAccounts(
  query: ListLoyaltyAccountsQuery,
): Promise<Paginated<LoyaltyAccountListItem>> {
  const db = getDb();
  const filters: SQL[] = [isNull(customers.deletedAt)];
  if (query.q) filters.push(ilike(customers.email, `%${query.q}%`));
  const where = and(...filters);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(loyaltyAccounts)
    .innerJoin(customers, eq(customers.id, loyaltyAccounts.customerId))
    .where(where);
  const rows = await db
    .select({
      id: loyaltyAccounts.id,
      customerId: customers.id,
      email: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
      balance: loyaltyAccounts.balance,
      lastActivityAt: loyaltyAccounts.updatedAt,
      createdAt: loyaltyAccounts.createdAt,
    })
    .from(loyaltyAccounts)
    .innerJoin(customers, eq(customers.id, loyaltyAccounts.customerId))
    .where(where)
    .orderBy(desc(loyaltyAccounts.updatedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

/** Admin detail: customer identity + balance + paginated ledger. */
export async function adminGetLoyaltyDetail(
  customerId: string,
  query: { page: number; pageSize: number },
): Promise<LoyaltyAdminDetail> {
  const db = getDb();
  const customer = await db.query.customers.findFirst({
    columns: { id: true, email: true, firstName: true, lastName: true },
    where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
  });
  if (!customer) throw notFound("Customer not found");
  const view = await getLoyaltyAccount(customerId, query);
  return { customer, ...view };
}

/**
 * Manual admin adjustment (±) with a required reason. Row-locked so it
 * can't interleave with a webhook earn; the balance never goes below 0.
 * Bootstraps the account if the customer has never earned. Attribution
 * (adminUserId) is also written to the audit log by the calling route.
 */
export async function adminAdjustLoyalty(
  customerId: string,
  delta: number,
  reason: string,
  adminUserId: string,
): Promise<{ balance: number; entry: LoyaltyLedgerEntry }> {
  if (!Number.isInteger(delta) || delta === 0) throw badRequest("Adjustment must be a non-zero integer");
  if (!reason.trim()) throw badRequest("Reason is required");
  void adminUserId; // actor recorded in the audit log by the admin route

  const db = getDb();
  const customer = await db.query.customers.findFirst({
    columns: { id: true },
    where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
  });
  if (!customer) throw notFound("Customer not found");

  return db.transaction(async (tx) => {
    await tx.insert(loyaltyAccounts).values({ customerId }).onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.customerId, customerId))
      .for("update");
    if (!account) throw new Error("Loyalty account bootstrap failed");

    const next = account.balance + delta;
    if (next < 0) {
      throw badRequest(`Adjustment would make the balance negative (current ${account.balance})`);
    }

    const [entry] = await tx
      .insert(loyaltyLedger)
      .values({ accountId: account.id, delta, reason: reason.trim() })
      .returning();
    if (!entry) throw new Error("Loyalty ledger insert failed");
    await tx
      .update(loyaltyAccounts)
      .set({ balance: next, updatedAt: new Date() })
      .where(eq(loyaltyAccounts.id, account.id));

    return { balance: next, entry };
  });
}
