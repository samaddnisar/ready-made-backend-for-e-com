import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, productStatusEnum, softDelete, timestamps } from "./_shared";

export const products = pgTable(
  "products",
  {
    id: id(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: productStatusEnum("status").notNull().default("draft"),
    // Base pricing (minor units) — variants may override.
    basePrice: integer("base_price"),
    baseCompareAtPrice: integer("base_compare_at_price"),
    // SEO
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    ogImageUrl: text("og_image_url"),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    // Partial: soft-deleted rows release their slug for reuse.
    uniqueIndex("products_slug_idx").on(t.slug).where(sql`deleted_at is null`),
    index("products_status_idx").on(t.status),
    index("products_title_idx").on(t.title),
  ],
).enableRLS();

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku"),
    title: text("title"), // e.g. "M / Black"
    price: integer("price").notNull(),
    compareAtPrice: integer("compare_at_price"),
    // { size: "M", color: "Black" }
    optionValues: jsonb("option_values").$type<Record<string, string>>().notNull().default({}),
    weightGrams: integer("weight_grams"),
    barcode: text("barcode"),
    position: integer("position").notNull().default(0),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("product_variants_product_id_idx").on(t.productId),
    uniqueIndex("product_variants_sku_idx").on(t.sku).where(sql`deleted_at is null`),
  ],
).enableRLS();

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    alt: text("alt"),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("product_images_product_id_idx").on(t.productId),
    index("product_images_variant_id_idx").on(t.variantId),
  ],
).enableRLS();

export const categories = pgTable(
  "categories",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    parentId: uuid("parent_id").references((): any => categories.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    ogImageUrl: text("og_image_url"),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("categories_slug_idx").on(t.slug).where(sql`deleted_at is null`),
    index("categories_parent_id_idx").on(t.parentId),
  ],
).enableRLS();

export const collections = pgTable(
  "collections",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    isManual: boolean("is_manual").notNull().default(true),
    // Rule-based collections: [{ field: "category", operator: "equals", value: "<id>" }]
    rules: jsonb("rules").$type<Array<{ field: string; operator: string; value: string }>>(),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    ogImageUrl: text("og_image_url"),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [uniqueIndex("collections_slug_idx").on(t.slug).where(sql`deleted_at is null`)],
).enableRLS();

export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    index("product_categories_category_id_idx").on(t.categoryId),
  ],
).enableRLS();

export const productCollections = pgTable(
  "product_collections",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.collectionId] }),
    index("product_collections_collection_id_idx").on(t.collectionId),
  ],
).enableRLS();

/** Manual "related products" curation (related_products feature). */
export const productRelations = pgTable(
  "product_relations",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: uuid("related_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.relatedProductId] })],
).enableRLS();
