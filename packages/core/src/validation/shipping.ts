import { z } from "zod";
import { moneySchema } from "./common";

const countryCode = z
  .string()
  .regex(/^([A-Za-z]{2}|\*)$/, "ISO country code or * for rest of world")
  .transform((v) => v.toUpperCase() === "*" ? "*" : v.toUpperCase());

export const createShippingZoneSchema = z
  .object({
    name: z.string().min(1).max(200),
    /** ISO 3166-1 alpha-2 codes; "*" = rest of world. */
    countries: z.array(countryCode).min(1).max(300),
  })
  .strict();

export const updateShippingZoneSchema = createShippingZoneSchema.partial().strict();

export const createShippingRateSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(["flat", "weight", "price"]).default("flat"),
    price: moneySchema,
    /** weight: grams bounds; price: cart-subtotal bounds (minor units). */
    minCondition: z.number().int().min(0).nullable().optional(),
    maxCondition: z.number().int().min(0).nullable().optional(),
    isActive: z.boolean().default(true),
    position: z.number().int().min(0).default(0),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.minCondition !== null &&
      val.minCondition !== undefined &&
      val.maxCondition !== null &&
      val.maxCondition !== undefined &&
      val.minCondition > val.maxCondition
    ) {
      ctx.addIssue({ code: "custom", path: ["maxCondition"], message: "Max must be ≥ min" });
    }
  });

export const updateShippingRateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    type: z.enum(["flat", "weight", "price"]).optional(),
    price: moneySchema.optional(),
    minCondition: z.number().int().min(0).nullable().optional(),
    maxCondition: z.number().int().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict();

export const updateTaxSettingsSchema = z
  .object({
    mode: z.enum(["none", "flat", "stripe_tax"]).optional(),
    /** Basis points, e.g. 2000 = 20%. */
    rateBps: z.number().int().min(0).max(10_000).optional(),
    pricesIncludeTax: z.boolean().optional(),
  })
  .strict();

export type CreateShippingZoneInput = z.infer<typeof createShippingZoneSchema>;
export type UpdateShippingZoneInput = z.infer<typeof updateShippingZoneSchema>;
export type CreateShippingRateInput = z.infer<typeof createShippingRateSchema>;
export type UpdateShippingRateInput = z.infer<typeof updateShippingRateSchema>;
export type UpdateTaxSettingsInput = z.infer<typeof updateTaxSettingsSchema>;
