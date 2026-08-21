import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import {
  categories,
  collections as collectionsTable,
  inventory,
  productCategories,
  productCollections,
  productImages,
  productRelations,
  products,
  productVariants,
} from "../db/schema";
import { badRequest, notFound } from "../errors";
import { getAvailability } from "../inventory/service";
import { paginate, type Paginated } from "../validation/common";
import type {
  CreateProductInput,
  ListProductsQuery,
  PublicListProductsQuery,
  UpdateProductInput,
} from "../validation/catalog";
import { slugify, uniqueSlug } from "../utils/slug";

// ── Types ────────────────────────────────────────────────────

export type ProductListItem = {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "active" | "archived";
  minPrice: number | null;
  maxPrice: number | null;
  variantCount: number;
  totalStock: number | null;
  thumbnailUrl: string | null;
  updatedAt: Date;
};

export type ProductDetail = typeof products.$inferSelect & {
  variants: (typeof productVariants.$inferSelect)[];
  images: (typeof productImages.$inferSelect)[];
  categoryIds: string[];
  collectionIds: string[];
  relatedProductIds: string[];
};

export type PublicProduct = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  compareAtPrice: number | null;
  images: { url: string; alt: string | null }[];
  variants: {
    id: string;
    title: string | null;
    sku: string | null;
    price: number;
    compareAtPrice: number | null;
    optionValues: Record<string, string>;
    /** Purchasable right now (untracked, backorderable, or stock available). */
    inStock: boolean;
  }[];
  categories: { name: string; slug: string }[];
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
};

// ── Helpers ──────────────────────────────────────────────────

const notDeleted = isNull(products.deletedAt);

async function resolveSlug(db: Db, title: string, requested?: string, excludeId?: string) {
  const base = requested ?? slugify(title);
  const rows = await db
    .select({ slug: products.slug, id: products.id })
    .from(products)
    .where(and(ilike(products.slug, `${base}%`), isNull(products.deletedAt)));
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug));
  return uniqueSlug(base, taken);
}

const minPriceSql = sql<number | null>`(select min(pv.price) from product_variants pv where pv.product_id = ${products.id} and pv.deleted_at is null)`;
const maxPriceSql = sql<number | null>`(select max(pv.price) from product_variants pv where pv.product_id = ${products.id} and pv.deleted_at is null)`;
const variantCountSql = sql<number>`(select count(*)::int from product_variants pv where pv.product_id = ${products.id} and pv.deleted_at is null)`;
const totalStockSql = sql<number | null>`(select sum(i.quantity - i.reserved_qty)::int from inventory i join product_variants pv on pv.id = i.variant_id where pv.product_id = ${products.id} and pv.deleted_at is null and i.track_inventory)`;
const thumbnailSql = sql<string | null>`(select pi.url from product_images pi where pi.product_id = ${products.id} order by pi.position asc, pi.created_at asc limit 1)`;

// ── Admin: list ──────────────────────────────────────────────

export async function listProducts(query: ListProductsQuery): Promise<Paginated<ProductListItem>> {
  const db = getDb();
  const filters: SQL[] = [notDeleted];

  if (query.status) filters.push(eq(products.status, query.status));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(products.title, term),
        ilike(products.slug, term),
        sql`exists (select 1 from product_variants pv where pv.product_id = ${products.id} and pv.sku ilike ${term} and pv.deleted_at is null)`,
      )!,
    );
  }
  if (query.categoryId) {
    filters.push(
      sql`exists (select 1 from product_categories pc where pc.product_id = ${products.id} and pc.category_id = ${query.categoryId})`,
    );
  }
  if (query.collectionId) {
    filters.push(
      sql`exists (select 1 from product_collections pcl where pcl.product_id = ${products.id} and pcl.collection_id = ${query.collectionId})`,
    );
  }

  const where = and(...filters);
  const direction = query.order === "asc" ? asc : desc;
  const orderBy =
    query.sort === "title"
      ? direction(products.title)
      : query.sort === "createdAt"
        ? direction(products.createdAt)
        : query.sort === "price"
          ? query.order === "asc"
            ? sql`${minPriceSql} asc nulls last`
            : sql`${minPriceSql} desc nulls last`
          : direction(products.updatedAt);

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      status: products.status,
      minPrice: minPriceSql,
      maxPrice: maxPriceSql,
      variantCount: variantCountSql,
      totalStock: totalStockSql,
      thumbnailUrl: thumbnailSql,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(where)
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

// ── Admin: read ──────────────────────────────────────────────

export async function getProductById(id: string): Promise<ProductDetail> {
  const db = getDb();
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), notDeleted),
    with: {
      variants: {
        where: isNull(productVariants.deletedAt),
        orderBy: asc(productVariants.position),
      },
      images: { orderBy: asc(productImages.position) },
      productCategories: true,
      productCollections: true,
    },
  });
  if (!product) throw notFound("Product not found");

  const related = await db
    .select({ relatedProductId: productRelations.relatedProductId })
    .from(productRelations)
    .where(eq(productRelations.productId, id))
    .orderBy(asc(productRelations.position));

  const { productCategories: pcs, productCollections: pcls, ...rest } = product;
  return {
    ...rest,
    categoryIds: pcs.map((c) => c.categoryId),
    collectionIds: pcls.map((c) => c.collectionId),
    relatedProductIds: related.map((r) => r.relatedProductId),
  };
}

// ── Admin: create ────────────────────────────────────────────

export async function createProduct(input: CreateProductInput): Promise<ProductDetail> {
  const db = getDb();
  const slug = await resolveSlug(db, input.title, input.slug);

  const productId = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        title: input.title,
        slug,
        description: input.description ?? null,
        status: input.status,
        basePrice: input.basePrice ?? null,
        baseCompareAtPrice: input.baseCompareAtPrice ?? null,
        metaTitle: input.metaTitle ?? null,
        metaDescription: input.metaDescription ?? null,
        ogImageUrl: input.ogImageUrl ?? null,
      })
      .returning({ id: products.id });
    if (!product) throw new Error("Insert failed");

    await assertReferencedIdsExist(tx, input);
    await insertVariants(tx, product.id, input.variants);
    await replaceImages(tx, product.id, input.images);
    await replaceLinks(tx, product.id, input.categoryIds, input.collectionIds);
    if (input.relatedProductIds) await replaceRelated(tx, product.id, input.relatedProductIds);
    return product.id;
  });

  return getProductById(productId);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** §9: referenced ids must fail as 4xx with the offending ids, never FK 500s. */
async function assertReferencedIdsExist(
  tx: Tx,
  input: Pick<UpdateProductInput, "categoryIds" | "collectionIds" | "relatedProductIds">,
): Promise<void> {
  const check = async (
    ids: string[] | undefined,
    table: typeof categories | typeof collectionsTable | typeof products,
    label: string,
  ) => {
    if (!ids || ids.length === 0) return;
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(inArray(table.id, ids), isNull(table.deletedAt)));
    const known = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) throw badRequest(`Unknown ${label}: ${missing.join(", ")}`);
  };
  await check(input.categoryIds, categories, "categories");
  await check(input.collectionIds, collectionsTable, "collections");
  await check(input.relatedProductIds, products, "related products");
}

async function insertVariants(
  tx: Tx,
  productId: string,
  variants: CreateProductInput["variants"],
): Promise<void> {
  for (const v of variants) {
    const [row] = await tx
      .insert(productVariants)
      .values({
        productId,
        sku: v.sku ?? null,
        title: v.title ?? null,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        optionValues: v.optionValues,
        weightGrams: v.weightGrams ?? null,
        barcode: v.barcode ?? null,
        position: v.position,
      })
      .returning({ id: productVariants.id });
    if (row) await tx.insert(inventory).values({ variantId: row.id }).onConflictDoNothing();
  }
}

async function replaceImages(
  tx: Tx,
  productId: string,
  images: NonNullable<UpdateProductInput["images"]>,
): Promise<void> {
  await tx.delete(productImages).where(eq(productImages.productId, productId));
  if (images.length > 0) {
    // An image may only reference this product's own variants (§9).
    const referenced = [
      ...new Set(images.map((i) => i.variantId).filter((v): v is string => Boolean(v))),
    ];
    if (referenced.length > 0) {
      const rows = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(productVariants.productId, productId), isNull(productVariants.deletedAt)));
      const own = new Set(rows.map((r) => r.id));
      const foreign = referenced.filter((v) => !own.has(v));
      if (foreign.length > 0) {
        throw badRequest(`Image variant ids not on this product: ${foreign.join(", ")}`);
      }
    }
    await tx.insert(productImages).values(
      images.map((img, i) => ({
        productId,
        url: img.url,
        alt: img.alt ?? null,
        position: img.position ?? i,
        variantId: img.variantId ?? null,
      })),
    );
  }
}

async function replaceLinks(
  tx: Tx,
  productId: string,
  categoryIds?: string[],
  collectionIds?: string[],
): Promise<void> {
  if (categoryIds) {
    await tx.delete(productCategories).where(eq(productCategories.productId, productId));
    if (categoryIds.length > 0) {
      await tx
        .insert(productCategories)
        .values(categoryIds.map((categoryId) => ({ productId, categoryId })))
        .onConflictDoNothing();
    }
  }
  if (collectionIds) {
    // Preserve the collection's curated ordering: links that already exist
    // keep their position; new links are appended at the end.
    const existing = await tx
      .select({ collectionId: productCollections.collectionId, position: productCollections.position })
      .from(productCollections)
      .where(eq(productCollections.productId, productId));
    const keptPosition = new Map(existing.map((l) => [l.collectionId, l.position]));

    await tx.delete(productCollections).where(eq(productCollections.productId, productId));
    if (collectionIds.length > 0) {
      const newIds = collectionIds.filter((id) => !keptPosition.has(id));
      const maxPosition = new Map<string, number>();
      if (newIds.length > 0) {
        const rows = await tx
          .select({
            collectionId: productCollections.collectionId,
            max: sql<number>`max(${productCollections.position})::int`,
          })
          .from(productCollections)
          .where(inArray(productCollections.collectionId, newIds))
          .groupBy(productCollections.collectionId);
        for (const r of rows) maxPosition.set(r.collectionId, r.max);
      }
      await tx
        .insert(productCollections)
        .values(
          collectionIds.map((collectionId) => ({
            productId,
            collectionId,
            position: keptPosition.get(collectionId) ?? (maxPosition.get(collectionId) ?? -1) + 1,
          })),
        )
        .onConflictDoNothing();
    }
  }
}

async function replaceRelated(tx: Tx, productId: string, relatedIds: string[]): Promise<void> {
  await tx.delete(productRelations).where(eq(productRelations.productId, productId));
  const filtered = relatedIds.filter((id) => id !== productId);
  if (filtered.length > 0) {
    await tx
      .insert(productRelations)
      .values(filtered.map((relatedProductId, i) => ({ productId, relatedProductId, position: i })))
      .onConflictDoNothing();
  }
}

// ── Admin: update ────────────────────────────────────────────

export async function updateProduct(id: string, input: UpdateProductInput): Promise<ProductDetail> {
  const db = getDb();
  const existing = await db.query.products.findFirst({ where: and(eq(products.id, id), notDeleted) });
  if (!existing) throw notFound("Product not found");

  const slug =
    input.slug !== undefined || input.title !== undefined
      ? await resolveSlug(db, input.title ?? existing.title, input.slug ?? existing.slug, id)
      : undefined;

  await db.transaction(async (tx) => {
    await assertReferencedIdsExist(tx, input);
    await tx
      .update(products)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
        ...(input.baseCompareAtPrice !== undefined
          ? { baseCompareAtPrice: input.baseCompareAtPrice }
          : {}),
        ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
        ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
        ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, id));

    if (input.variants) {
      const current = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(productVariants.productId, id), isNull(productVariants.deletedAt)));
      const keepIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));
      const toDelete = current.map((v) => v.id).filter((vid) => !keepIds.has(vid));

      if (toDelete.length > 0) {
        // Soft delete — cart/order items may reference these variants.
        await tx
          .update(productVariants)
          .set({ deletedAt: new Date() })
          .where(inArray(productVariants.id, toDelete));
      }
      for (const v of input.variants) {
        if (v.id) {
          await tx
            .update(productVariants)
            .set({
              sku: v.sku ?? null,
              title: v.title ?? null,
              price: v.price,
              compareAtPrice: v.compareAtPrice ?? null,
              optionValues: v.optionValues,
              weightGrams: v.weightGrams ?? null,
              barcode: v.barcode ?? null,
              position: v.position,
              updatedAt: new Date(),
            })
            .where(and(eq(productVariants.id, v.id), eq(productVariants.productId, id)));
        } else {
          await insertVariants(tx, id, [v]);
        }
      }
    }

    if (input.images) await replaceImages(tx, id, input.images);
    await replaceLinks(tx, id, input.categoryIds, input.collectionIds);
    if (input.relatedProductIds) await replaceRelated(tx, id, input.relatedProductIds);
  });

  return getProductById(id);
}

// ── Admin: delete + bulk ─────────────────────────────────────

export async function softDeleteProduct(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(products)
    .set({ deletedAt: new Date() })
    .where(and(eq(products.id, id), notDeleted))
    .returning({ id: products.id });
  if (!row) throw notFound("Product not found");
}

export async function bulkProductAction(
  ids: string[],
  action: "publish" | "draft" | "archive" | "delete",
): Promise<number> {
  const db = getDb();
  if (action === "delete") {
    const rows = await db
      .update(products)
      .set({ deletedAt: new Date() })
      .where(and(inArray(products.id, ids), notDeleted))
      .returning({ id: products.id });
    return rows.length;
  }
  const status = action === "publish" ? "active" : action === "archive" ? "archived" : "draft";
  const rows = await db
    .update(products)
    .set({ status, updatedAt: new Date() })
    .where(and(inArray(products.id, ids), notDeleted))
    .returning({ id: products.id });
  return rows.length;
}

// ── Public ───────────────────────────────────────────────────

const publicVisible = and(notDeleted, eq(products.status, "active"));

/** One collection rule → a SQL filter. Rules combine with AND (all must match). */
function collectionRuleToSql(rule: { field: string; operator: string; value: string }): SQL {
  if (rule.field === "category") {
    // Value may be a category slug (typed in the admin) or a category id.
    const match =
      rule.operator === "contains"
        ? sql`(c.slug ilike ${"%" + rule.value + "%"} or c.name ilike ${"%" + rule.value + "%"})`
        : sql`(c.slug = ${rule.value} or c.id::text = ${rule.value})`;
    return sql`exists (select 1 from product_categories pc join categories c on c.id = pc.category_id and c.deleted_at is null where pc.product_id = ${products.id} and ${match})`;
  }
  // field === "title"
  return rule.operator === "contains"
    ? ilike(products.title, `%${rule.value}%`)
    : sql`lower(${products.title}) = lower(${rule.value})`;
}

export async function listPublicProducts(
  query: PublicListProductsQuery,
): Promise<Paginated<Omit<PublicProduct, "variants" | "categories">>> {
  const db = getDb();
  const filters: SQL[] = [publicVisible!];
  let manualCollectionOrder: SQL | undefined;

  if (query.q) filters.push(ilike(products.title, `%${query.q}%`));
  if (query.category) {
    filters.push(
      sql`exists (select 1 from product_categories pc join categories c on c.id = pc.category_id and c.deleted_at is null where pc.product_id = ${products.id} and c.slug = ${query.category})`,
    );
  }
  if (query.collection) {
    const collection = await db.query.collections.findFirst({
      where: and(eq(collectionsTable.slug, query.collection), isNull(collectionsTable.deletedAt)),
    });
    if (!collection) return paginate([], query.page, query.pageSize, 0);

    if (collection.isManual || !collection.rules?.length) {
      filters.push(
        sql`exists (select 1 from product_collections pcl where pcl.product_id = ${products.id} and pcl.collection_id = ${collection.id})`,
      );
      // Default sort for a manual collection is its curated order.
      if (query.sort === "newest") {
        manualCollectionOrder = sql`(select pcl.position from product_collections pcl where pcl.product_id = ${products.id} and pcl.collection_id = ${collection.id}) asc`;
      }
    } else {
      // Rule-based: membership is computed, not materialized in the join table.
      for (const rule of collection.rules) filters.push(collectionRuleToSql(rule));
    }
  }

  const where = and(...filters);
  const orderBy =
    manualCollectionOrder ??
    (query.sort === "price_asc"
      ? sql`${minPriceSql} asc nulls last`
      : query.sort === "price_desc"
        ? sql`${minPriceSql} desc nulls last`
        : query.sort === "title"
          ? asc(products.title)
          : desc(products.createdAt));

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      description: products.description,
      minPrice: minPriceSql,
      maxPrice: maxPriceSql,
      compareAtPrice: products.baseCompareAtPrice,
      thumbnailUrl: thumbnailSql,
      metaTitle: products.metaTitle,
      metaDescription: products.metaDescription,
      ogImageUrl: products.ogImageUrl,
    })
    .from(products)
    .where(where)
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    description: r.description,
    minPrice: r.minPrice,
    maxPrice: r.maxPrice,
    compareAtPrice: r.compareAtPrice,
    images: r.thumbnailUrl ? [{ url: r.thumbnailUrl, alt: null }] : [],
    metaTitle: r.metaTitle,
    metaDescription: r.metaDescription,
    ogImageUrl: r.ogImageUrl,
  }));
  return paginate(items, query.page, query.pageSize, countRow?.total ?? 0);
}

export async function getPublicProductBySlug(slug: string): Promise<PublicProduct> {
  const db = getDb();
  const product = await db.query.products.findFirst({
    where: and(eq(products.slug, slug), publicVisible),
    with: {
      variants: {
        where: isNull(productVariants.deletedAt),
        orderBy: asc(productVariants.position),
      },
      images: { orderBy: asc(productImages.position) },
      productCategories: { with: { category: true } },
    },
  });
  if (!product) throw notFound("Product not found");

  const availability = await getAvailability(product.variants.map((v) => v.id));
  const prices = product.variants.map((v) => v.price);
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    minPrice: prices.length ? Math.min(...prices) : product.basePrice,
    maxPrice: prices.length ? Math.max(...prices) : product.basePrice,
    compareAtPrice: product.baseCompareAtPrice,
    images: product.images.map((i) => ({ url: i.url, alt: i.alt })),
    variants: product.variants.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      optionValues: v.optionValues,
      inStock: availability.get(v.id)?.inStock ?? true,
    })),
    categories: product.productCategories
      .filter((pc) => pc.category.deletedAt === null)
      .map((pc) => ({ name: pc.category.name, slug: pc.category.slug })),
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    ogImageUrl: product.ogImageUrl,
  };
}

/** Related products (feature: related_products): manual curation first, then same-category fallback. */
export async function getRelatedProducts(
  productId: string,
  limit = 8,
): Promise<{ id: string; title: string; slug: string; minPrice: number | null; thumbnailUrl: string | null }[]> {
  const db = getDb();
  const fields = {
    id: products.id,
    title: products.title,
    slug: products.slug,
    minPrice: minPriceSql,
    thumbnailUrl: thumbnailSql,
  };

  const manual = await db
    .select(fields)
    .from(productRelations)
    .innerJoin(products, eq(products.id, productRelations.relatedProductId))
    .where(and(eq(productRelations.productId, productId), publicVisible))
    .orderBy(asc(productRelations.position))
    .limit(limit);
  if (manual.length >= limit) return manual;

  const fallback = await db
    .select(fields)
    .from(products)
    .where(
      and(
        publicVisible,
        sql`${products.id} <> ${productId}`,
        sql`${products.id} not in (select pr.related_product_id from product_relations pr where pr.product_id = ${productId})`,
        sql`exists (select 1 from product_categories pc1 where pc1.product_id = ${products.id} and pc1.category_id in (select pc2.category_id from product_categories pc2 where pc2.product_id = ${productId}))`,
      ),
    )
    .orderBy(desc(products.createdAt))
    .limit(limit - manual.length);

  return [...manual, ...fallback];
}
