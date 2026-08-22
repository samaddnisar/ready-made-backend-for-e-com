import { and, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { newsletterSubscribers } from "../db/schema";
import { emailSchema, paginate, paginationQuerySchema, type Paginated } from "../validation/common";

/**
 * Newsletter module (feature: "newsletter") — self-contained: schemas,
 * service functions and types in one file (§4 toggleable modules).
 *
 * Privacy stance: the public subscribe/unsubscribe surface is deliberately
 * an existence-oracle-free API. Subscribe always succeeds (idempotent),
 * unsubscribe always succeeds (even for unknown emails), so responses never
 * reveal whether an address is on the list.
 */

// ── Schemas ──────────────────────────────────────────────────

export const newsletterSubscribeSchema = z
  .object({
    email: emailSchema,
    /** Where the signup came from, e.g. "storefront_footer", "checkout". */
    source: z.string().max(100).optional(),
  })
  .strict();

export const newsletterUnsubscribeSchema = z.object({ email: emailSchema }).strict();

export const listNewsletterQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  // NOT z.coerce.boolean() — that treats "false" as true (non-empty string).
  active: z.stringbool().optional(),
});

export type NewsletterSubscribeInput = z.infer<typeof newsletterSubscribeSchema>;
export type NewsletterUnsubscribeInput = z.infer<typeof newsletterUnsubscribeSchema>;
export type ListNewsletterQuery = z.infer<typeof listNewsletterQuerySchema>;

export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;

// ── Service ──────────────────────────────────────────────────

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Subscribe an email (idempotent):
 * - new email → insert as active;
 * - previously unsubscribed → reactivate (isActive true, unsubscribedAt
 *   cleared, subscribedAt reset to now);
 * - already active → no-op, returns the existing row (never an error, so
 *   the public endpoint can't be used to probe the list).
 */
export async function subscribeToNewsletter(
  email: string,
  source?: string,
): Promise<NewsletterSubscriber> {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const now = new Date();

  // Single race-safe upsert on the unique email index. setWhere skips the
  // update for already-active rows so their subscribedAt is preserved.
  const [row] = await db
    .insert(newsletterSubscribers)
    .values({ email: normalized, source: source ?? null })
    .onConflictDoUpdate({
      target: newsletterSubscribers.email,
      set: {
        isActive: true,
        unsubscribedAt: null,
        subscribedAt: now,
        updatedAt: now,
        ...(source !== undefined ? { source } : {}),
      },
      setWhere: sql`${newsletterSubscribers.isActive} = false`,
    })
    .returning();
  if (row) return row;

  // Conflict + setWhere skipped the update → already an active subscriber.
  const [existing] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, normalized));
  if (!existing) throw new Error("Newsletter subscribe failed"); // unreachable
  return existing;
}

/**
 * Unsubscribe an email (idempotent): flips active subscribers to inactive
 * and stamps unsubscribedAt. Unknown or already-unsubscribed emails silently
 * succeed — no existence oracle, and repeat calls never move the timestamp.
 */
export async function unsubscribeFromNewsletter(email: string): Promise<void> {
  const db = getDb();
  await db
    .update(newsletterSubscribers)
    .set({ isActive: false, unsubscribedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(newsletterSubscribers.email, normalizeEmail(email)),
        eq(newsletterSubscribers.isActive, true),
      ),
    );
}

export type NewsletterList = Paginated<NewsletterSubscriber> & {
  /** Total active subscribers (unfiltered) — powers the admin stat card. */
  activeCount: number;
};

export async function listNewsletterSubscribers(
  query: ListNewsletterQuery,
): Promise<NewsletterList> {
  const db = getDb();
  const filters: SQL[] = [];
  if (query.q) filters.push(ilike(newsletterSubscribers.email, `%${query.q}%`));
  if (query.active !== undefined) filters.push(eq(newsletterSubscribers.isActive, query.active));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [countRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(newsletterSubscribers)
    .where(where);
  const [activeRow] = await db
    .select({ activeCount: sql<number>`count(*)::int` })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.isActive, true));
  const rows = await db
    .select()
    .from(newsletterSubscribers)
    .where(where)
    .orderBy(desc(newsletterSubscribers.subscribedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    ...paginate(rows, query.page, query.pageSize, countRow?.total ?? 0),
    activeCount: activeRow?.activeCount ?? 0,
  };
}

/** All active subscriber emails, oldest signup first (for exports/campaigns). */
export async function exportActiveNewsletterEmails(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ email: newsletterSubscribers.email })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.isActive, true))
    .orderBy(newsletterSubscribers.subscribedAt);
  return rows.map((r) => r.email);
}

/**
 * Quote a CSV field when it contains a delimiter, quote or newline; prefix
 * formula-leading characters (= + - @) with a single quote so a crafted
 * "email" can never execute as a formula when the export is opened in a
 * spreadsheet (CSV injection defense — §9).
 */
const csvField = (value: string): string => {
  const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(neutralized)
    ? `"${neutralized.replaceAll('"', '""')}"`
    : neutralized;
};

/** CSV document (header `email,subscribedAt`) of all active subscribers. */
export async function exportActiveNewsletterCsv(): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({
      email: newsletterSubscribers.email,
      subscribedAt: newsletterSubscribers.subscribedAt,
    })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.isActive, true))
    .orderBy(newsletterSubscribers.subscribedAt);
  const lines = rows.map((r) => `${csvField(r.email)},${r.subscribedAt.toISOString()}`);
  return ["email,subscribedAt", ...lines].join("\n") + "\n";
}
