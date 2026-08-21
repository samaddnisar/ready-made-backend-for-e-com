import { z } from "zod";
import { uuidSchema } from "./common";

/** Public cart API — carts are addressed by their opaque session token. */

export const cartTokenSchema = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const addCartItemSchema = z
  .object({
    variantId: uuidSchema,
    quantity: z.number().int().min(1).max(999),
  })
  .strict();

export const updateCartItemsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            variantId: uuidSchema,
            /** 0 removes the line. */
            quantity: z.number().int().min(0).max(999),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemsInput = z.infer<typeof updateCartItemsSchema>;
