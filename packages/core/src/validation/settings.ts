import { z } from "zod";
import { FEATURE_KEYS } from "../features/flags";
import { currencySchema, emailSchema } from "./common";

const featureFlagsPatchSchema = z
  .object(
    Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
      (typeof FEATURE_KEYS)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

export const updateSettingsSchema = z
  .object({
    storeName: z.string().min(1).max(200).optional(),
    storeEmail: emailSchema.nullable().optional(),
    storePhone: z.string().max(50).nullable().optional(),
    storeAddress: z
      .object({
        line1: z.string().max(200).optional(),
        line2: z.string().max(200).optional(),
        city: z.string().max(100).optional(),
        region: z.string().max(100).optional(),
        postalCode: z.string().max(20).optional(),
        country: z.string().length(2).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    logoUrl: z.url().nullable().optional(),
    currency: currencySchema.optional(),
    featureFlags: featureFlagsPatchSchema.optional(),
    emailConfig: z
      .object({
        fromName: z.string().max(100).optional(),
        fromAddress: emailSchema.optional(),
        replyTo: emailSchema.optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
