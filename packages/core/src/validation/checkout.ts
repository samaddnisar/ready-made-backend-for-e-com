import { z } from "zod";
import { emailSchema } from "./common";
import { cartTokenSchema } from "./cart";

export const checkoutAddressSchema = z
  .object({
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    company: z.string().max(200).optional(),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(1).max(100),
    region: z.string().max(100).optional(),
    postalCode: z.string().min(1).max(20),
    /** ISO 3166-1 alpha-2. */
    country: z
      .string()
      .length(2)
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase()),
    phone: z.string().max(50).optional(),
  })
  .strict();

export const checkoutSchema = z
  .object({
    cartToken: cartTokenSchema,
    email: emailSchema,
    shippingAddress: checkoutAddressSchema,
    /** Defaults to the shipping address when omitted. */
    billingAddress: checkoutAddressSchema.optional(),
    /** Phase 5: shipping rate selection; validated against zones server-side. */
    shippingRateId: z.uuid().optional(),
    /** Phase 5: discount code. */
    discountCode: z.string().max(100).optional(),
  })
  .strict();

export type CheckoutAddress = z.infer<typeof checkoutAddressSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
