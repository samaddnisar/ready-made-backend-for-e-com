import { z } from "zod";
import { moneySchema, paginationQuerySchema, uuidSchema } from "./common";

export const discountCodeSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, hyphens and underscores only")
  .transform((v) => v.toUpperCase());

const discountBase = {
  code: discountCodeSchema,
  type: z.enum(["percent", "fixed", "free_shipping"]),
  /** percent: 0–100 (whole percents); fixed: minor units; free_shipping: ignored. */
  value: z.number().int().min(0).max(1_000_000),
  minSpend: moneySchema.nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).max(1_000).nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  appliesTo: z.enum(["all", "products", "categories"]).default("all"),
  /** Scope targets when appliesTo != all. */
  productIds: z.array(uuidSchema).max(200).optional(),
  categoryIds: z.array(uuidSchema).max(100).optional(),
  stackable: z.boolean().default(false),
  isActive: z.boolean().default(true),
};

export const createDiscountSchema = z
  .object(discountBase)
  .strict()
  .superRefine((val, ctx) => {
    if (val.type === "percent" && val.value > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Percent can't exceed 100" });
    }
    if (val.type !== "free_shipping" && val.value <= 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Value must be positive" });
    }
    if (val.appliesTo === "products" && !val.productIds?.length) {
      ctx.addIssue({ code: "custom", path: ["productIds"], message: "Select at least one product" });
    }
    if (val.appliesTo === "categories" && !val.categoryIds?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["categoryIds"],
        message: "Select at least one category",
      });
    }
    if (val.startsAt && val.endsAt && new Date(val.startsAt) >= new Date(val.endsAt)) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
    }
  });

export const updateDiscountSchema = z
  .object({
    code: discountCodeSchema.optional(),
    type: z.enum(["percent", "fixed", "free_shipping"]).optional(),
    value: z.number().int().min(0).max(1_000_000).optional(),
    minSpend: moneySchema.nullable().optional(),
    usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
    perCustomerLimit: z.number().int().min(1).max(1_000).nullable().optional(),
    startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    appliesTo: z.enum(["all", "products", "categories"]).optional(),
    productIds: z.array(uuidSchema).max(200).optional(),
    categoryIds: z.array(uuidSchema).max(100).optional(),
    stackable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const listDiscountsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  active: z.coerce.boolean().optional(),
});

/** Storefront: apply/remove codes on a cart. */
export const applyDiscountSchema = z
  .object({ code: discountCodeSchema })
  .strict();

export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
export type ListDiscountsQuery = z.infer<typeof listDiscountsQuerySchema>;
