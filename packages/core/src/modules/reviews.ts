import { and, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { customers, orderItems, orders, products, productVariants, reviews } from "../db/schema";
import { conflict, notFound } from "../errors";
import { paginate, paginationQuerySchema, uuidSchema, type Paginated } from "../validation/common";

/**
 * Reviews module (feature: reviews, §4).
 *
 * Customers with an account submit a review per product (unique customer +
 * product); reviews land as "pending" and only show on the storefront once
 * an admin approves them. Verified-purchase detection links the review to a
 * paid-family order that contains the product.
 */

// ── Schemas ──────────────────────────────────────────────────

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const submitReviewSchema = z
  .object({
    productId: uuidSchema,
    rating: z.number().int().min(1).max(5),
    title: z.string().max(200).optional(),
    body: z.string().max(5000).optional(),
  })
  .strict();

export const listReviewsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(REVIEW_STATUSES).optional(),
  /** Searches the product title. */
  q: z.string().max(200).optional(),
});

export const moderateReviewSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
  })
  .strict();

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;

export type Review = typeof reviews.$inferSelect;

/** Orders the customer actually paid for and kept (same family as LTV). */
const PAID_FAMILY = [
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "completed",
  "partially_refunded",
] as const;

/** "Jane Doe" → "Jane D." — never expose the full name publicly. */
function anonymizeName(firstName: string | null, lastName: string | null): string {
  if (!firstName) return "Anonymous";
  const initial = lastName?.trim().charAt(0);
  return initial ? `${firstName} ${initial.toUpperCase()}.` : firstName;
}

// ── Storefront ───────────────────────────────────────────────

/**
 * Submit a review for an active product. One review per customer + product;
 * a paid-family order containing one of the product's variants marks the
 * review as a verified purchase (orderId set).
 */
export async function submitReview(customerId: string, input: SubmitReviewInput): Promise<Review> {
  const db = getDb();

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, input.productId),
      eq(products.status, "active"),
      isNull(products.deletedAt),
    ),
    columns: { id: true },
  });
  if (!product) throw notFound("Product not found");

  // Friendly duplicate message before hitting the unique index.
  const existing = await db.query.reviews.findFirst({
    where: and(eq(reviews.customerId, customerId), eq(reviews.productId, input.productId)),
    columns: { id: true },
  });
  if (existing) throw conflict("You have already reviewed this product");

  // Verified purchase: a kept, paid order containing a variant of this product.
  const [purchase] = await db
    .select({ orderId: orders.id })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(
      and(
        eq(orders.customerId, customerId),
        eq(productVariants.productId, input.productId),
        inArray(orders.status, [...PAID_FAMILY]),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);

  // Race-safe: a concurrent duplicate hits the unique index → no row → 409.
  const [row] = await db
    .insert(reviews)
    .values({
      productId: input.productId,
      customerId,
      orderId: purchase?.orderId ?? null,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body ?? null,
    })
    .onConflictDoNothing({ target: [reviews.customerId, reviews.productId] })
    .returning();
  if (!row) throw conflict("You have already reviewed this product");
  return row;
}

export type PublicReviewItem = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  /** Anonymized: "Jane D." */
  customerName: string;
  verifiedPurchase: boolean;
  createdAt: Date;
};

export type ReviewSummary = {
  /** Average of approved ratings, rounded to 2 decimals; 0 when no reviews. */
  averageRating: number;
  reviewCount: number;
};

export type PublicReviewsResult = Paginated<PublicReviewItem> & { summary: ReviewSummary };

/** Approved reviews for a live product, plus the rating summary. */
export async function listPublicReviews(
  productSlug: string,
  query: { page: number; pageSize: number },
): Promise<PublicReviewsResult> {
  const db = getDb();

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.slug, productSlug),
      eq(products.status, "active"),
      isNull(products.deletedAt),
    ),
    columns: { id: true },
  });
  if (!product) throw notFound("Product not found");

  const where = and(eq(reviews.productId, product.id), eq(reviews.status, "approved"));

  const [summaryRow] = await db
    .select({
      reviewCount: sql<number>`count(*)::int`,
      averageRating: sql<number>`coalesce(round(avg(${reviews.rating})::numeric, 2), 0)::float8`,
    })
    .from(reviews)
    .where(where);
  const summary: ReviewSummary = {
    averageRating: summaryRow?.averageRating ?? 0,
    reviewCount: summaryRow?.reviewCount ?? 0,
  };

  // Left join so reviews survive a soft-deleted customer (shown as Anonymous).
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      orderId: reviews.orderId,
      createdAt: reviews.createdAt,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(reviews)
    .leftJoin(customers, and(eq(customers.id, reviews.customerId), isNull(customers.deletedAt)))
    .where(where)
    .orderBy(desc(reviews.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const items: PublicReviewItem[] = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    customerName: anonymizeName(r.firstName ?? null, r.lastName ?? null),
    verifiedPurchase: r.orderId !== null,
    createdAt: r.createdAt,
  }));

  return { ...paginate(items, query.page, query.pageSize, summary.reviewCount), summary };
}

// ── Admin ────────────────────────────────────────────────────

export type AdminReviewListItem = {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  createdAt: Date;
};

/**
 * Moderation queue. Joins product + customer for display only — reviews of a
 * soft-deleted product/customer stay visible so admins can still moderate or
 * delete them.
 */
export async function listReviewsAdmin(
  query: ListReviewsQuery,
): Promise<Paginated<AdminReviewListItem>> {
  const db = getDb();
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(reviews.status, query.status));
  if (query.q) filters.push(ilike(products.title, `%${query.q}%`));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .where(where);

  const rows = await db
    .select({
      id: reviews.id,
      productId: reviews.productId,
      productTitle: products.title,
      productSlug: products.slug,
      customerId: reviews.customerId,
      firstName: customers.firstName,
      lastName: customers.lastName,
      customerEmail: customers.email,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      status: reviews.status,
      orderId: reviews.orderId,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .leftJoin(customers, eq(customers.id, reviews.customerId))
    .where(where)
    .orderBy(desc(reviews.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const items: AdminReviewListItem[] = rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productTitle: r.productTitle,
    productSlug: r.productSlug,
    customerId: r.customerId,
    customerName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
    customerEmail: r.customerEmail,
    rating: r.rating,
    title: r.title,
    body: r.body,
    status: r.status,
    verifiedPurchase: r.orderId !== null,
    createdAt: r.createdAt,
  }));

  return paginate(items, query.page, query.pageSize, countRow?.total ?? 0);
}

/** Approve or reject a review. */
export async function moderateReview(id: string, status: ModerateReviewInput["status"]): Promise<Review> {
  const db = getDb();
  const [row] = await db
    .update(reviews)
    .set({ status, updatedAt: new Date() })
    .where(eq(reviews.id, id))
    .returning();
  if (!row) throw notFound("Review not found");
  return row;
}

/** Hard delete — reviews carry no money data and have no soft-delete column. */
export async function deleteReview(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db.delete(reviews).where(eq(reviews.id, id)).returning({ id: reviews.id });
  if (!row) throw notFound("Review not found");
}
