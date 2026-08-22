import { z } from "zod";
import { paginationQuerySchema } from "./common";

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: z.enum(["createdAt", "lifetimeValue", "orderCount"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/** Admin-side edits. */
export const updateCustomerAdminSchema = z
  .object({
    firstName: z.string().max(100).nullable().optional(),
    lastName: z.string().max(100).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    marketingOptIn: z.boolean().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();

/** Customer-side profile edits (no notes — those are internal). */
export const updateProfileSchema = z
  .object({
    firstName: z.string().max(100).nullable().optional(),
    lastName: z.string().max(100).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .strict();

export const addressInputSchema = z
  .object({
    type: z.enum(["shipping", "billing"]).default("shipping"),
    firstName: z.string().max(100).nullable().optional(),
    lastName: z.string().max(100).nullable().optional(),
    company: z.string().max(200).nullable().optional(),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).nullable().optional(),
    city: z.string().min(1).max(100),
    region: z.string().max(100).nullable().optional(),
    postalCode: z.string().min(1).max(20),
    country: z
      .string()
      .length(2)
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase()),
    phone: z.string().max(50).nullable().optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const updateAddressSchema = z
  .object({
    type: z.enum(["shipping", "billing"]).optional(),
    firstName: z.string().max(100).nullable().optional(),
    lastName: z.string().max(100).nullable().optional(),
    company: z.string().max(200).nullable().optional(),
    line1: z.string().min(1).max(200).optional(),
    line2: z.string().max(200).nullable().optional(),
    city: z.string().min(1).max(100).optional(),
    region: z.string().max(100).nullable().optional(),
    postalCode: z.string().min(1).max(20).optional(),
    country: z
      .string()
      .length(2)
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase())
      .optional(),
    phone: z.string().max(50).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type UpdateCustomerAdminInput = z.infer<typeof updateCustomerAdminSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AddressInput = z.infer<typeof addressInputSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
