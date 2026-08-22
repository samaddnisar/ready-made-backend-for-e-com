import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { customers, giftCards, giftCardTransactions } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { paginate, paginationQuerySchema, uuidSchema, type Paginated } from "../validation/common";

/**
 * Gift cards module (feature: gift_cards, §4).
 *
 * Scope: issuance, balance ledger and public validation. Every balance
 * change writes a `gift_card_transactions` row (money path), balances are
 * integer minor units and can never go below zero. Redemption as a checkout
 * tender is deliberately out of scope until Phase 9+.
 */

// ── Schemas ──────────────────────────────────────────────────

export const GIFT_CARD_STATUSES = ["active", "disabled", "depleted"] as const;

export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];

export const issueGiftCardSchema = z
  .object({
    /** Integer minor units (cents); must be a positive load. */
    initialBalance: z.number().int().positive(),
    customerId: uuidSchema.optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const adjustGiftCardSchema = z
  .object({
    /** Integer minor units; positive = load, negative = deduct. Never zero. */
    delta: z
      .number()
      .int()
      .refine((v) => v !== 0, "Adjustment must be non-zero"),
    note: z.string().min(1).max(500),
  })
  .strict();

export const listGiftCardsQuerySchema = paginationQuerySchema.extend({
  /** Matches against the card code (paste a full code to find a card). */
  q: z.string().max(100).optional(),
  status: z.enum(GIFT_CARD_STATUSES).optional(),
});

/** Public storefront validation body. */
export const validateGiftCardSchema = z
  .object({
    code: z.string().min(1).max(100),
  })
  .strict();

/** Admin PATCH body: one strict variant per action. */
export const giftCardAdminActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("adjust"),
      delta: z
        .number()
        .int()
        .refine((v) => v !== 0, "Adjustment must be non-zero"),
      note: z.string().min(1).max(500),
    })
    .strict(),
  z.object({ action: z.literal("disable") }).strict(),
  z.object({ action: z.literal("enable") }).strict(),
]);

export type IssueGiftCardInput = z.infer<typeof issueGiftCardSchema>;
export type AdjustGiftCardInput = z.infer<typeof adjustGiftCardSchema>;
export type ListGiftCardsQuery = z.infer<typeof listGiftCardsQuerySchema>;
export type ValidateGiftCardInput = z.infer<typeof validateGiftCardSchema>;
export type GiftCardAdminAction = z.infer<typeof giftCardAdminActionSchema>;

export type GiftCard = typeof giftCards.$inferSelect;
export type GiftCardTransaction = typeof giftCardTransactions.$inferSelect;

// ── Code generation ──────────────────────────────────────────

/** A-Z + 2-9 minus the lookalikes 0/O and 1/I — 32 characters. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;

/** "GC-" + 16 crypto-random chars. 256 % 32 === 0, so byte % 32 is unbiased. */
function generateGiftCardCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let body = "";
  for (const byte of bytes) body += CODE_ALPHABET[byte % CODE_ALPHABET.length]!;
  return `GC-${body}`;
}

/** "GC-••••ABCD" — list views never show the full code. */
function maskCode(code: string): string {
  return `GC-••••${code.slice(-4)}`;
}

// ── Issuance ─────────────────────────────────────────────────

/**
 * Issue a new gift card in the store currency. The full code is returned
 * exactly here and on the admin detail view — list views mask it. The
 * initial load is recorded as the card's first ledger row.
 */
export async function issueGiftCard(input: IssueGiftCardInput, currency: string): Promise<GiftCard> {
  const db = getDb();

  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw badRequest("Expiry must be in the future");
  }

  if (input.customerId) {
    const customer = await db.query.customers.findFirst({
      where: and(eq(customers.id, input.customerId), isNull(customers.deletedAt)),
      columns: { id: true },
    });
    if (!customer) throw badRequest("Customer not found");
  }

  return db.transaction(async (tx) => {
    // Collisions are ~impossible (32^16 codes) but the unique index is the
    // backstop — retry a fresh code instead of surfacing a 409.
    for (let attempt = 0; attempt < 5; attempt++) {
      const [card] = await tx
        .insert(giftCards)
        .values({
          code: generateGiftCardCode(),
          initialBalance: input.initialBalance,
          balance: input.initialBalance,
          currency,
          status: "active",
          customerId: input.customerId ?? null,
          expiresAt,
        })
        .onConflictDoNothing({ target: giftCards.code })
        .returning();
      if (!card) continue;

      await tx.insert(giftCardTransactions).values({
        giftCardId: card.id,
        delta: input.initialBalance,
        note: input.note ?? "Initial load",
      });
      return card;
    }
    throw new Error("Failed to generate a unique gift card code");
  });
}

// ── Admin reads ──────────────────────────────────────────────

export type GiftCardListItem = {
  id: string;
  /** Masked: "GC-••••ABCD". Full codes only appear on the detail view. */
  maskedCode: string;
  initialBalance: number;
  balance: number;
  currency: string;
  status: GiftCardStatus;
  customerId: string | null;
  customerEmail: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export async function listGiftCards(query: ListGiftCardsQuery): Promise<Paginated<GiftCardListItem>> {
  const db = getDb();
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(giftCards.status, query.status));
  if (query.q) filters.push(ilike(giftCards.code, `%${query.q}%`));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(giftCards)
    .where(where);

  const rows = await db
    .select({
      id: giftCards.id,
      code: giftCards.code,
      initialBalance: giftCards.initialBalance,
      balance: giftCards.balance,
      currency: giftCards.currency,
      status: giftCards.status,
      customerId: giftCards.customerId,
      customerEmail: customers.email,
      expiresAt: giftCards.expiresAt,
      createdAt: giftCards.createdAt,
    })
    .from(giftCards)
    .leftJoin(customers, and(eq(customers.id, giftCards.customerId), isNull(customers.deletedAt)))
    .where(where)
    .orderBy(desc(giftCards.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const items: GiftCardListItem[] = rows.map(({ code, ...row }) => ({
    ...row,
    maskedCode: maskCode(code),
  }));

  return paginate(items, query.page, query.pageSize, countRow?.total ?? 0);
}

export type GiftCardDetail = GiftCard & {
  customerEmail: string | null;
  transactions: GiftCardTransaction[];
};

/** Admin detail: full code + the complete balance ledger, newest first. */
export async function getGiftCard(id: string): Promise<GiftCardDetail> {
  const db = getDb();
  const card = await db.query.giftCards.findFirst({ where: eq(giftCards.id, id) });
  if (!card) throw notFound("Gift card not found");

  const customer = card.customerId
    ? await db.query.customers.findFirst({
        where: and(eq(customers.id, card.customerId), isNull(customers.deletedAt)),
        columns: { email: true },
      })
    : undefined;

  const transactions = await db
    .select()
    .from(giftCardTransactions)
    .where(eq(giftCardTransactions.giftCardId, id))
    .orderBy(desc(giftCardTransactions.createdAt), desc(giftCardTransactions.id));

  return { ...card, customerEmail: customer?.email ?? null, transactions };
}

// ── Admin mutations ──────────────────────────────────────────

/**
 * Manual balance adjustment (row-locked). The balance can never go below
 * zero; hitting exactly zero auto-flips status to "depleted" and loading a
 * depleted card back above zero re-activates it. A manually disabled card
 * keeps its "disabled" status either way. The actor is recorded by the
 * route-level audit log; `adminUserId` is part of the service contract for
 * call-site clarity (the ledger schema has no actor column).
 */
export async function adjustBalance(
  id: string,
  delta: number,
  note: string,
  _adminUserId?: string,
): Promise<GiftCard> {
  const db = getDb();
  if (!Number.isInteger(delta) || delta === 0) throw badRequest("Adjustment must be non-zero");

  return db.transaction(async (tx) => {
    const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, id)).for("update");
    if (!card) throw notFound("Gift card not found");

    const next = card.balance + delta;
    if (next < 0) {
      throw badRequest(`Adjustment would make the balance negative (current ${card.balance})`);
    }

    const status: GiftCardStatus =
      card.status === "disabled" ? "disabled" : next === 0 ? "depleted" : "active";

    const [updated] = await tx
      .update(giftCards)
      .set({ balance: next, status, updatedAt: new Date() })
      .where(eq(giftCards.id, id))
      .returning();

    await tx.insert(giftCardTransactions).values({ giftCardId: id, delta, note });

    return updated!;
  });
}

/**
 * Manually disable / re-enable a card. Re-enabling a card with a zero
 * balance lands on "depleted" (the auto status), not "active".
 */
export async function setStatus(id: string, status: "active" | "disabled"): Promise<GiftCard> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, id)).for("update");
    if (!card) throw notFound("Gift card not found");

    const next: GiftCardStatus =
      status === "disabled" ? "disabled" : card.balance === 0 ? "depleted" : "active";

    const [updated] = await tx
      .update(giftCards)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(giftCards.id, id))
      .returning();
    return updated!;
  });
}

// ── Public validation ────────────────────────────────────────

export type GiftCardValidationResult =
  | { valid: true; balance: number; currency: string; status: "active" }
  | { valid: false };

/** Constant shape for every invalid outcome — no existence oracle. */
const INVALID: GiftCardValidationResult = { valid: false };

/**
 * Public storefront check. Valid = an active, unexpired card with a positive
 * balance. Every other outcome — unknown code, disabled, depleted, expired,
 * malformed input — returns the identical `{ valid: false }` so the endpoint
 * leaks nothing about which codes exist. Never throws for unknown codes and
 * NEVER exposes customer information.
 */
export async function validateGiftCard(code: string): Promise<GiftCardValidationResult> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return INVALID;

  const db = getDb();
  const card = await db.query.giftCards.findFirst({
    where: eq(giftCards.code, normalized),
    columns: { balance: true, currency: true, status: true, expiresAt: true },
  });

  if (!card) return INVALID;
  if (card.status !== "active") return INVALID;
  if (card.expiresAt && card.expiresAt.getTime() <= Date.now()) return INVALID;
  if (card.balance <= 0) return INVALID;

  return { valid: true, balance: card.balance, currency: card.currency, status: "active" };
}
