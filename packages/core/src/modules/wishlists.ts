import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { products, productVariants, wishlistItems, wishlists } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { getAvailability } from "../inventory/service";
import { paginate, uuidSchema, type Paginated, type PaginationQuery } from "../validation/common";

/**
 * Wishlists (feature: wishlists) — one implicit wishlist per customer.
 * Self-contained module: zod schemas + service + types (§4 toggleable module).
 */

// ── Schemas ──────────────────────────────────────────────────

export const addWishlistItemSchema = z
  .object({
    productId: uuidSchema,
    variantId: uuidSchema.optional(),
  })
  .strict();

export type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>;

// ── Types ────────────────────────────────────────────────────

export type Wishlist = typeof wishlists.$inferSelect;
export type WishlistItem = typeof wishlistItems.$inferSelect;

export type WishlistItemView = {
  id: string;
  productId: string;
  variantId: string | null;
  title: string;
  slug: string;
  minPrice: number | null;
  thumbnailUrl: string | null;
  /** Purchasable right now (untracked, backorderable, or stock available). */
  inStock: boolean;
  addedAt: Date;
};

export type WishlistView = {
  id: string;
  name: string;
  items: WishlistItemView[];
};

export type MostWishlistedProduct = {
  productId: string;
  title: string;
  slug: string;
  /** How many wishlists contain this product. */
  count: number;
};

export type WishlistSummary = {
  totalWishlists: number;
  totalItems: number;
  products: Paginated<MostWishlistedProduct>;
};

// ── Helpers ──────────────────────────────────────────────────

/** Storefront visibility: live products only (soft delete + status respected). */
const publicVisible = and(isNull(products.deletedAt), eq(products.status, "active"));

// Correlated subqueries with QUALIFIED table refs (products.id) — same
// pattern as catalog/products.ts so they work under any join shape.
const minPriceSql = sql<
  number | null
>`(select min(pv.price) from product_variants pv where pv.product_id = products.id and pv.deleted_at is null)`;
const thumbnailSql = sql<
  string | null
>`(select pi.url from product_images pi where pi.product_id = products.id order by pi.position asc, pi.created_at asc limit 1)`;

// ── Customer: get-or-create ──────────────────────────────────

/** The customer's wishlist, created on first touch (default name "Wishlist"). */
export async function getOrCreateWishlist(customerId: string): Promise<Wishlist> {
  const db = getDb();
  const existing = await db.query.wishlists.findFirst({
    where: eq(wishlists.customerId, customerId),
    orderBy: asc(wishlists.createdAt),
  });
  if (existing) return existing;

  const [created] = await db.insert(wishlists).values({ customerId }).returning();
  if (!created) throw new Error("Wishlist insert failed");
  return created;
}

// ── Customer: view ───────────────────────────────────────────

/**
 * The customer's wishlist with live product info. Items whose product was
 * soft-deleted or unpublished are hidden (not deleted — they reappear if the
 * product comes back).
 */
export async function getWishlistView(customerId: string): Promise<WishlistView> {
  const db = getDb();
  const wishlist = await getOrCreateWishlist(customerId);

  const rows = await db
    .select({
      id: wishlistItems.id,
      productId: wishlistItems.productId,
      variantId: wishlistItems.variantId,
      title: products.title,
      slug: products.slug,
      minPrice: minPriceSql,
      thumbnailUrl: thumbnailSql,
      addedAt: wishlistItems.createdAt,
    })
    .from(wishlistItems)
    .innerJoin(products, eq(products.id, wishlistItems.productId))
    .where(and(eq(wishlistItems.wishlistId, wishlist.id), publicVisible))
    .orderBy(desc(wishlistItems.createdAt));

  // Stock: check the pinned variant when the item saved one (and it still
  // exists), otherwise any of the product's live variants.
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const variantRows =
    productIds.length > 0
      ? await db
          .select({ id: productVariants.id, productId: productVariants.productId })
          .from(productVariants)
          .where(
            and(inArray(productVariants.productId, productIds), isNull(productVariants.deletedAt)),
          )
      : [];
  const liveVariantIds = new Set(variantRows.map((v) => v.id));
  const variantsByProduct = new Map<string, string[]>();
  for (const v of variantRows) {
    const list = variantsByProduct.get(v.productId);
    if (list) list.push(v.id);
    else variantsByProduct.set(v.productId, [v.id]);
  }
  const availability = await getAvailability(variantRows.map((v) => v.id));

  const items: WishlistItemView[] = rows.map((r) => {
    const pinned = r.variantId && liveVariantIds.has(r.variantId) ? r.variantId : null;
    const productVariantIds = variantsByProduct.get(r.productId) ?? [];
    const inStock = pinned
      ? (availability.get(pinned)?.inStock ?? true)
      : productVariantIds.length === 0
        ? true // base-price product without variants = untracked = purchasable
        : productVariantIds.some((id) => availability.get(id)?.inStock ?? true);
    return { ...r, inStock };
  });

  return { id: wishlist.id, name: wishlist.name, items };
}

// ── Customer: add / remove ───────────────────────────────────

/**
 * Save a product (idempotent — re-adding an already-saved product is a no-op
 * via the unique (wishlist, product) index + onConflictDoNothing).
 */
export async function addWishlistItem(
  customerId: string,
  input: AddWishlistItemInput,
): Promise<WishlistItem> {
  const db = getDb();

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, input.productId), publicVisible),
    columns: { id: true },
  });
  if (!product) throw notFound("Product not found");

  if (input.variantId) {
    const variant = await db.query.productVariants.findFirst({
      where: and(
        eq(productVariants.id, input.variantId),
        eq(productVariants.productId, input.productId),
        isNull(productVariants.deletedAt),
      ),
      columns: { id: true },
    });
    if (!variant) throw badRequest("Variant does not belong to this product");
  }

  const wishlist = await getOrCreateWishlist(customerId);
  const [inserted] = await db
    .insert(wishlistItems)
    .values({
      wishlistId: wishlist.id,
      productId: input.productId,
      variantId: input.variantId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  // Already saved — return the existing row unchanged.
  const existing = await db.query.wishlistItems.findFirst({
    where: and(
      eq(wishlistItems.wishlistId, wishlist.id),
      eq(wishlistItems.productId, input.productId),
    ),
  });
  if (!existing) throw new Error("Wishlist item insert failed");
  return existing;
}

/** Remove a saved product. 404 when the product isn't on the wishlist. */
export async function removeWishlistItem(customerId: string, productId: string): Promise<void> {
  const db = getDb();
  const wishlist = await db.query.wishlists.findFirst({
    where: eq(wishlists.customerId, customerId),
    orderBy: asc(wishlists.createdAt),
  });
  if (!wishlist) throw notFound("Wishlist item not found");

  const removed = await db
    .delete(wishlistItems)
    .where(and(eq(wishlistItems.wishlistId, wishlist.id), eq(wishlistItems.productId, productId)))
    .returning({ id: wishlistItems.id });
  if (removed.length === 0) throw notFound("Wishlist item not found");
}

// ── Admin: summary ───────────────────────────────────────────

/**
 * Read-only merchandising view: which products customers save most.
 * Soft-deleted products are excluded everywhere (counts included).
 */
export async function adminWishlistSummary(query: PaginationQuery): Promise<WishlistSummary> {
  const db = getDb();
  const productNotDeleted = isNull(products.deletedAt);

  const [wishlistCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(wishlists);

  const [itemCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(wishlistItems)
    .innerJoin(products, eq(products.id, wishlistItems.productId))
    .where(productNotDeleted);

  const [productCount] = await db
    .select({ total: sql<number>`count(distinct ${wishlistItems.productId})::int` })
    .from(wishlistItems)
    .innerJoin(products, eq(products.id, wishlistItems.productId))
    .where(productNotDeleted);

  const rows = await db
    .select({
      productId: wishlistItems.productId,
      title: products.title,
      slug: products.slug,
      count: sql<number>`count(*)::int`,
    })
    .from(wishlistItems)
    .innerJoin(products, eq(products.id, wishlistItems.productId))
    .where(productNotDeleted)
    .groupBy(wishlistItems.productId, products.title, products.slug)
    .orderBy(sql`count(*) desc`, asc(products.title))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    totalWishlists: wishlistCount?.total ?? 0,
    totalItems: itemCount?.total ?? 0,
    products: paginate(rows, query.page, query.pageSize, productCount?.total ?? 0),
  };
}
