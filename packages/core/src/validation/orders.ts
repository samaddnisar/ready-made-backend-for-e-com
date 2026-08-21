import { z } from "zod";
import { moneySchema, paginationQuerySchema } from "./common";

export const orderStatusSchema = z.enum([
  "pending",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "completed",
  "partially_refunded",
  "refunded",
  "cancelled",
  "payment_failed",
]);

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: orderStatusSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z.enum(["createdAt", "grandTotal"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/** Manual admin transitions only — paid/payment_failed belong to the webhook, refund states to the refund flow. */
export const updateOrderStatusSchema = z
  .object({
    status: z.enum(["fulfilled", "shipped", "delivered", "completed", "cancelled"]),
    note: z.string().max(1000).optional(),
  })
  .strict();

export const updateOrderNotesSchema = z
  .object({ notes: z.string().max(5000).nullable() })
  .strict();

export const createRefundSchema = z
  .object({
    /** Minor units; must not exceed the remaining refundable amount. */
    amount: moneySchema.refine((v) => v > 0, "Refund amount must be positive"),
    reason: z.string().max(500).optional(),
  })
  .strict();

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type CreateRefundInput = z.infer<typeof createRefundSchema>;
