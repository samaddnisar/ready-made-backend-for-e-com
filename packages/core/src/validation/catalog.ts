import { z } from "zod";
import {
  loosePaginationQuerySchema,
  moneySchema,
  paginationQuerySchema,
  slugSchema,
  uuidSchema,
} from "./common";

// http(s) only — these URLs render on public storefronts (§9 XSS defense).
const httpUrlSchema = z.url({ protocol: /^https?$/ });

const seoFields = {
  metaTitle: z.string().max(200).nullable().optional(),
  metaDescription: z.string().max(500).nullable().optional(),
  ogImageUrl: httpUrlSchema.nullable().optional(),
};

// ── Products ─────────────────────────────────────────────────

export const variantInputSchema = z
  .object({
    /** Present when updating an existing variant; absent for new ones. */
    id: uuidSchema.optional(),
    sku: z.string().max(100).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    price: moneySchema,
    compareAtPrice: moneySchema.nullable().optional(),
    optionValues: z.record(z.string().max(50), z.string().max(100)).default({}),
    weightGrams: z.number().int().min(0).nullable().optional(),
    barcode: z.string().max(100).nullable().optional(),
    position: z.number().int().min(0).default(0),
  })
  .strict();

export const imageInputSchema = z
  .object({
    url: httpUrlSchema,
    alt: z.string().max(300).nullable().optional(),
    position: z.number().int().min(0).default(0),
    variantId: uuidSchema.nullable().optional(),
  })
  .strict();

export const productStatusSchema = z.enum(["draft", "active", "archived"]);

export const createProductSchema = z
  .object({
    title: z.string().min(1).max(300),
    slug: slugSchema.optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: productStatusSchema.default("draft"),
    basePrice: moneySchema.nullable().optional(),
    baseCompareAtPrice: moneySchema.nullable().optional(),
    variants: z.array(variantInputSchema).min(1, "At least one variant is required").max(100),
    images: z.array(imageInputSchema).max(50).default([]),
    categoryIds: z.array(uuidSchema).max(50).default([]),
    collectionIds: z.array(uuidSchema).max(50).default([]),
    relatedProductIds: z.array(uuidSchema).max(20).optional(),
    ...seoFields,
  })
  .strict();

export const updateProductSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    slug: slugSchema.optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: productStatusSchema.optional(),
    basePrice: moneySchema.nullable().optional(),
    baseCompareAtPrice: moneySchema.nullable().optional(),
    /** Full sync when present: absent ids are soft-deleted, new ones created. */
    variants: z.array(variantInputSchema).min(1).max(100).optional(),
    /** Replace-all when present. */
    images: z.array(imageInputSchema).max(50).optional(),
    categoryIds: z.array(uuidSchema).max(50).optional(),
    collectionIds: z.array(uuidSchema).max(50).optional(),
    relatedProductIds: z.array(uuidSchema).max(20).optional(),
    ...seoFields,
  })
  .strict();

export const listProductsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: productStatusSchema.optional(),
  categoryId: uuidSchema.optional(),
  collectionId: uuidSchema.optional(),
  sort: z.enum(["title", "createdAt", "updatedAt", "price"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const bulkProductActionSchema = z
  .object({
    ids: z.array(uuidSchema).min(1).max(100),
    action: z.enum(["publish", "draft", "archive", "delete"]),
  })
  .strict();

// ── Categories ───────────────────────────────────────────────

export const createCategorySchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: slugSchema.optional(),
    description: z.string().max(5_000).nullable().optional(),
    parentId: uuidSchema.nullable().optional(),
    position: z.number().int().min(0).default(0),
    ...seoFields,
  })
  .strict();

export const updateCategorySchema = createCategorySchema.partial().strict();

// ── Collections ──────────────────────────────────────────────

export const collectionRuleSchema = z
  .object({
    field: z.enum(["category", "title"]),
    operator: z.enum(["equals", "contains"]),
    value: z.string().min(1).max(200),
  })
  .strict();

export const createCollectionSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: slugSchema.optional(),
    description: z.string().max(5_000).nullable().optional(),
    isManual: z.boolean().default(true),
    rules: z.array(collectionRuleSchema).max(10).nullable().optional(),
    ...seoFields,
  })
  .strict();

export const updateCollectionSchema = createCollectionSchema.partial().strict();

export const setCollectionProductsSchema = z
  .object({
    /** Ordered — position follows array order. */
    productIds: z.array(uuidSchema).max(500),
  })
  .strict();

// ── Media ────────────────────────────────────────────────────

export const listMediaQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  type: z.enum(["image", "video", "other"]).optional(),
});

export const updateMediaSchema = z
  .object({ alt: z.string().max(300).nullable() })
  .strict();

// ── Public catalog queries ───────────────────────────────────

export const publicListProductsQuerySchema = loosePaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  category: slugSchema.optional(),
  collection: slugSchema.optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "title"]).default("newest"),
});

export type VariantInput = z.infer<typeof variantInputSchema>;
export type ImageInput = z.infer<typeof imageInputSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type BulkProductAction = z.infer<typeof bulkProductActionSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;
export type PublicListProductsQuery = z.infer<typeof publicListProductsQuerySchema>;
