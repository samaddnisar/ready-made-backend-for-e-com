import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

export const listInventoryQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  lowStockOnly: z.coerce.boolean().default(false),
});

export const adjustStockSchema = z
  .object({
    variantId: uuidSchema,
    /** Positive = received stock, negative = correction/shrinkage. */
    delta: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((v) => v !== 0, "Delta can't be zero"),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const updateInventoryConfigSchema = z
  .object({
    lowStockThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
    trackInventory: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
  })
  .strict();

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type UpdateInventoryConfigInput = z.infer<typeof updateInventoryConfigSchema>;
