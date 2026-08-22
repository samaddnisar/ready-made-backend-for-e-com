import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { abandonedCarts, cartItems, carts, productVariants, products } from "../db/schema";
import { notFound } from "../errors";
import { paginate, paginationQuerySchema, type Paginated, type PaginationQuery } from "../validation/common";

/**
 * Abandoned-cart recovery (feature: abandoned_cart).
 *
 * A cart counts as abandoned when it is still `active`, has at least one
 * item, hasn't been touched for a while, and we know an email to write to —
 * either the cart belongs to a customer account, or a (failed/pending)
 * order row for that cart captured a guest email at checkout.
 */

// ── Validation ───────────────────────────────────────────────

export const listAbandonedCartsQuerySchema = paginationQuerySchema;
export type ListAbandonedCartsQuery = PaginationQuery;

/** Admin "run detection now" action body — strict (§9). */
export const abandonedCartDetectSchema = z.object({ action: z.literal("detect") }).strict();
export type AbandonedCartDetectInput = z.infer<typeof abandonedCartDetectSchema>;

// ── Types ────────────────────────────────────────────────────

export type AbandonedCart = typeof abandonedCarts.$inferSelect;

export type AbandonedCartListItem = {
  id: string;
  cartId: string;
  email: string | null;
  itemCount: number;
  /** Sum of quantity × snapshot unit price, integer minor units. */
  cartValue: number;
  /** ISO 4217 code of the cart, e.g. "USD". */
  currency: string;
  abandonedAt: Date;
  reminderSentAt: Date | null;
  recoveredAt: Date | null;
  recoveryOrderId: string | null;
};

export type AbandonedCartDetailItem = {
  title: string;
  variantTitle: string | null;
  quantity: number;
  /** Snapshot price (minor units) captured when the item was added. */
  unitPrice: number;
  /** unitPrice × quantity, integer minor units. */
  lineTotal: number;
};

export type AbandonedCartDetail = {
  id: string;
  cartId: string;
  email: string | null;
  currency: string;
  cartValue: number;
  reminderSentAt: Date | null;
  recoveredAt: Date | null;
  items: AbandonedCartDetailItem[];
};

export type AbandonedCartDetectionResult = {
  /** Carts newly recorded as abandoned by this run. */
  detected: number;
};

// ── Correlated helpers (QUALIFIED outer refs, aliased inner tables) ──

/**
 * The email we could send a reminder to: the owning (non-deleted) customer's
 * email, else the email captured on any order row created for this cart
 * (guest checkouts always record one).
 *
 * Outer refs are QUALIFIED as raw text (`carts.id`, not `${carts.id}`):
 * drizzle serializes embedded columns UNQUALIFIED in single-table select
 * fields, and inside the subquery a bare "id" would bind to the inner
 * table's own column (o.id) instead of the outer cart.
 */
const knowableEmailSql = sql<string | null>`coalesce(
  (select c.email from customers c where c.id = carts.customer_id and c.deleted_at is null),
  (select o.email from orders o where o.cart_id = carts.id order by o.created_at desc limit 1)
)`;

// ── Detection ────────────────────────────────────────────────

/**
 * Find active carts with ≥1 item, last touched before the cutoff, and a
 * knowable email; record them in abandoned_carts (unique per cart —
 * re-running never duplicates) and flip the cart status to "abandoned".
 */
export async function detectAbandonedCarts(
  olderThanHours = 6,
  limit = 200,
): Promise<AbandonedCartDetectionResult> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);

  const candidates = await db
    .select({ id: carts.id, email: knowableEmailSql })
    .from(carts)
    .where(
      and(
        eq(carts.status, "active"),
        lt(carts.updatedAt, cutoff),
        sql`exists (select 1 from cart_items ci where ci.cart_id = ${carts.id})`,
        sql`${knowableEmailSql} is not null`,
      ),
    )
    .orderBy(asc(carts.updatedAt))
    .limit(limit);

  if (candidates.length === 0) return { detected: 0 };

  const cartIds = candidates.map((c) => c.id);
  const detected = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(abandonedCarts)
      .values(candidates.map((c) => ({ cartId: c.id, email: c.email })))
      .onConflictDoNothing({ target: abandonedCarts.cartId })
      .returning({ id: abandonedCarts.id });
    await tx
      .update(carts)
      .set({ status: "abandoned", updatedAt: new Date() })
      .where(inArray(carts.id, cartIds));
    return inserted.length;
  });

  return { detected };
}

// ── Admin list / detail ──────────────────────────────────────

export async function listAbandoned(
  query: ListAbandonedCartsQuery,
): Promise<Paginated<AbandonedCartListItem>> {
  const db = getDb();
  // Correlated subqueries with QUALIFIED outer refs (see knowableEmailSql).
  const itemCountSql = sql<number>`(select coalesce(sum(ci.quantity), 0)::int from cart_items ci where ci.cart_id = abandoned_carts.cart_id)`;
  const cartValueSql = sql<number>`(select coalesce(sum(ci.quantity * ci.unit_price), 0)::int from cart_items ci where ci.cart_id = abandoned_carts.cart_id)`;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(abandonedCarts);
  const rows = await db
    .select({
      id: abandonedCarts.id,
      cartId: abandonedCarts.cartId,
      email: abandonedCarts.email,
      itemCount: itemCountSql,
      cartValue: cartValueSql,
      currency: carts.currency,
      abandonedAt: abandonedCarts.createdAt,
      reminderSentAt: abandonedCarts.reminderSentAt,
      recoveredAt: abandonedCarts.recoveredAt,
      recoveryOrderId: abandonedCarts.recoveryOrderId,
    })
    .from(abandonedCarts)
    .innerJoin(carts, eq(carts.id, abandonedCarts.cartId))
    .orderBy(desc(abandonedCarts.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

/** One abandoned cart with its line items — feeds the reminder email. */
export async function getAbandonedCartDetail(id: string): Promise<AbandonedCartDetail> {
  const db = getDb();
  const [row] = await db
    .select({
      id: abandonedCarts.id,
      cartId: abandonedCarts.cartId,
      email: abandonedCarts.email,
      currency: carts.currency,
      reminderSentAt: abandonedCarts.reminderSentAt,
      recoveredAt: abandonedCarts.recoveredAt,
    })
    .from(abandonedCarts)
    .innerJoin(carts, eq(carts.id, abandonedCarts.cartId))
    .where(eq(abandonedCarts.id, id));
  if (!row) throw notFound("Abandoned cart not found");

  // Titles come from the live catalog (left joins: a since-deleted product
  // must not break the reminder — fall back to a generic label).
  const itemRows = await db
    .select({
      title: sql<string>`coalesce(${products.title}, 'Item')`,
      variantTitle: productVariants.title,
      quantity: cartItems.quantity,
      unitPrice: cartItems.unitPrice,
    })
    .from(cartItems)
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(eq(cartItems.cartId, row.cartId))
    .orderBy(asc(cartItems.createdAt));

  const items: AbandonedCartDetailItem[] = itemRows.map((item) => ({
    ...item,
    lineTotal: item.quantity * item.unitPrice,
  }));
  return {
    ...row,
    cartValue: items.reduce((sum, item) => sum + item.lineTotal, 0),
    items,
  };
}

// ── Mutations ────────────────────────────────────────────────

/** Stamp the reminder as sent (after the email actually went out). */
export async function markReminderSent(id: string): Promise<AbandonedCart> {
  const db = getDb();
  const [row] = await db
    .update(abandonedCarts)
    .set({ reminderSentAt: new Date(), updatedAt: new Date() })
    .where(eq(abandonedCarts.id, id))
    .returning();
  if (!row) throw notFound("Abandoned cart not found");
  return row;
}

/**
 * Called when a cart converts to an order: mark its abandoned record as
 * recovered. Idempotent — a no-op when the cart was never flagged, or when
 * a recovery was already stamped (the first converting order wins).
 */
export async function markRecovered(cartId: string, orderId: string): Promise<void> {
  const db = getDb();
  await db
    .update(abandonedCarts)
    .set({ recoveredAt: new Date(), recoveryOrderId: orderId, updatedAt: new Date() })
    .where(and(eq(abandonedCarts.cartId, cartId), isNull(abandonedCarts.recoveredAt)));
}
