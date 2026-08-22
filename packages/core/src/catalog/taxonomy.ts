import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { categories, collections, productCollections, products } from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { slugify, uniqueSlug } from "../utils/slug";
import type {
  CreateCategoryInput,
  CreateCollectionInput,
  UpdateCategoryInput,
  UpdateCollectionInput,
} from "../validation/catalog";

// ── Categories ───────────────────────────────────────────────

export type CategoryWithCount = typeof categories.$inferSelect & { productCount: number };

const categoryProductCountSql = sql<number>`(select count(*)::int from product_categories pc join products p on p.id = pc.product_id and p.deleted_at is null where pc.category_id = categories.id)`;

async function resolveCategorySlug(db: Db, name: string, requested?: string, excludeId?: string) {
  const base = requested ?? slugify(name);
  const rows = await db
    .select({ slug: categories.slug, id: categories.id })
    .from(categories)
    .where(and(ilike(categories.slug, `${base}%`), isNull(categories.deletedAt)));
  return uniqueSlug(base, new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug)));
}

/** Flat list (tree assembled by the caller via parentId). */
export async function listCategories(): Promise<CategoryWithCount[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      parentId: categories.parentId,
      position: categories.position,
      metaTitle: categories.metaTitle,
      metaDescription: categories.metaDescription,
      ogImageUrl: categories.ogImageUrl,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
      deletedAt: categories.deletedAt,
      productCount: categoryProductCountSql,
    })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .orderBy(asc(categories.position), asc(categories.name));
  return rows;
}

export async function createCategory(input: CreateCategoryInput) {
  const db = getDb();
  if (input.parentId) {
    const parent = await db.query.categories.findFirst({
      where: and(eq(categories.id, input.parentId), isNull(categories.deletedAt)),
    });
    if (!parent) throw notFound("Parent category not found");
  }
  const slug = await resolveCategorySlug(db, input.name, input.slug);
  const [row] = await db
    .insert(categories)
    .values({
      name: input.name,
      slug,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      position: input.position,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      ogImageUrl: input.ogImageUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

/**
 * Server-side cycle guard (§9 — never trust the client): walk the proposed
 * parent's ancestor chain; if `id` appears, the move would create a cycle
 * that detaches the subtree from the root.
 */
async function assertNoCategoryCycle(db: Db, id: string, parentId: string): Promise<void> {
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) throw conflict("A category can't be moved under itself or its descendants");
    if (seen.has(cursor)) break; // pre-existing cycle — don't spin forever
    seen.add(cursor);
    const [row] = await db
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, cursor));
    cursor = row?.parentId ?? null;
  }
}

export async function updateCategory(id: string, input: UpdateCategoryInput) {
  const db = getDb();
  const existing = await db.query.categories.findFirst({
    where: and(eq(categories.id, id), isNull(categories.deletedAt)),
  });
  if (!existing) throw notFound("Category not found");
  if (input.parentId === id) throw conflict("A category can't be its own parent");
  if (input.parentId) {
    const parent = await db.query.categories.findFirst({
      where: and(eq(categories.id, input.parentId), isNull(categories.deletedAt)),
    });
    if (!parent) throw notFound("Parent category not found");
    await assertNoCategoryCycle(db, id, input.parentId);
  }

  const slug =
    input.slug !== undefined || input.name !== undefined
      ? await resolveCategorySlug(db, input.name ?? existing.name, input.slug ?? existing.slug, id)
      : undefined;

  const [row] = await db
    .update(categories)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
      ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(categories.id, id))
    .returning();
  if (!row) throw notFound("Category not found");
  return row;
}

export async function softDeleteCategory(id: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .returning({ id: categories.id });
    if (!row) throw notFound("Category not found");
    // Orphan children to the root rather than deleting a whole subtree.
    await tx.update(categories).set({ parentId: null }).where(eq(categories.parentId, id));
  });
}

/** Public: categories that exist for storefront nav (with active-product counts). */
export async function listPublicCategories() {
  const db = getDb();
  // Public counts must only reflect what the storefront can actually list —
  // drafts/archived products are excluded from every other public path.
  const activeProductCountSql = sql<number>`(select count(*)::int from product_categories pc join products p on p.id = pc.product_id and p.deleted_at is null and p.status = 'active' where pc.category_id = categories.id)`;
  return db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      parentId: categories.parentId,
      position: categories.position,
      metaTitle: categories.metaTitle,
      metaDescription: categories.metaDescription,
      ogImageUrl: categories.ogImageUrl,
      productCount: activeProductCountSql,
    })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .orderBy(asc(categories.position), asc(categories.name));
}

// ── Collections ──────────────────────────────────────────────

export type CollectionWithCount = typeof collections.$inferSelect & { productCount: number };

const collectionProductCountSql = sql<number>`(select count(*)::int from product_collections pcl join products p on p.id = pcl.product_id and p.deleted_at is null where pcl.collection_id = collections.id)`;

async function resolveCollectionSlug(db: Db, name: string, requested?: string, excludeId?: string) {
  const base = requested ?? slugify(name);
  const rows = await db
    .select({ slug: collections.slug, id: collections.id })
    .from(collections)
    .where(and(ilike(collections.slug, `${base}%`), isNull(collections.deletedAt)));
  return uniqueSlug(base, new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug)));
}

export async function listCollections(): Promise<CollectionWithCount[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      isManual: collections.isManual,
      rules: collections.rules,
      metaTitle: collections.metaTitle,
      metaDescription: collections.metaDescription,
      ogImageUrl: collections.ogImageUrl,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      deletedAt: collections.deletedAt,
      productCount: collectionProductCountSql,
    })
    .from(collections)
    .where(isNull(collections.deletedAt))
    .orderBy(asc(collections.name));
  return rows;
}

export async function getCollectionById(id: string) {
  const db = getDb();
  const collection = await db.query.collections.findFirst({
    where: and(eq(collections.id, id), isNull(collections.deletedAt)),
  });
  if (!collection) throw notFound("Collection not found");
  const links = await db
    .select({ productId: productCollections.productId })
    .from(productCollections)
    .innerJoin(products, and(eq(products.id, productCollections.productId), isNull(products.deletedAt)))
    .where(eq(productCollections.collectionId, id))
    .orderBy(asc(productCollections.position));
  return { ...collection, productIds: links.map((l) => l.productId) };
}

export async function createCollection(input: CreateCollectionInput) {
  const db = getDb();
  const slug = await resolveCollectionSlug(db, input.name, input.slug);
  const [row] = await db
    .insert(collections)
    .values({
      name: input.name,
      slug,
      description: input.description ?? null,
      isManual: input.isManual,
      rules: input.rules ?? null,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      ogImageUrl: input.ogImageUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateCollection(id: string, input: UpdateCollectionInput) {
  const db = getDb();
  const existing = await db.query.collections.findFirst({
    where: and(eq(collections.id, id), isNull(collections.deletedAt)),
  });
  if (!existing) throw notFound("Collection not found");

  const slug =
    input.slug !== undefined || input.name !== undefined
      ? await resolveCollectionSlug(db, input.name ?? existing.name, input.slug ?? existing.slug, id)
      : undefined;

  const [row] = await db
    .update(collections)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isManual !== undefined ? { isManual: input.isManual } : {}),
      ...(input.rules !== undefined ? { rules: input.rules } : {}),
      ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
      ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(collections.id, id))
    .returning();
  if (!row) throw notFound("Collection not found");
  return row;
}

export async function softDeleteCollection(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(collections)
    .set({ deletedAt: new Date() })
    .where(and(eq(collections.id, id), isNull(collections.deletedAt)))
    .returning({ id: collections.id });
  if (!row) throw notFound("Collection not found");
}

/** Replace the manual product list (order = position). */
export async function setCollectionProducts(id: string, productIds: string[]): Promise<void> {
  const db = getDb();
  const existing = await db.query.collections.findFirst({
    where: and(eq(collections.id, id), isNull(collections.deletedAt)),
  });
  if (!existing) throw notFound("Collection not found");

  if (productIds.length > 0) {
    const found = await db
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, productIds), isNull(products.deletedAt)));
    const known = new Set(found.map((r) => r.id));
    const missing = productIds.filter((pid) => !known.has(pid));
    if (missing.length > 0) throw badRequest(`Unknown products: ${missing.join(", ")}`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(productCollections).where(eq(productCollections.collectionId, id));
    if (productIds.length > 0) {
      await tx
        .insert(productCollections)
        .values(productIds.map((productId, i) => ({ productId, collectionId: id, position: i })))
        .onConflictDoNothing();
    }
  });
}

/** Public: collection metadata by slug (products come from listPublicProducts). */
export async function getPublicCollectionBySlug(slug: string) {
  const db = getDb();
  const collection = await db.query.collections.findFirst({
    where: and(eq(collections.slug, slug), isNull(collections.deletedAt)),
  });
  if (!collection) throw notFound("Collection not found");
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    description: collection.description,
    metaTitle: collection.metaTitle,
    metaDescription: collection.metaDescription,
    ogImageUrl: collection.ogImageUrl,
  };
}
