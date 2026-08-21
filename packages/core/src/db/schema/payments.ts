import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, paymentStatusEnum, refundStatusEnum, timestamps } from "./_shared";
import { orders } from "./orders";

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    /** e.g. "card", "link" — from the PaymentIntent's payment_method type. */
    method: text("method"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payments_stripe_payment_intent_id_idx").on(t.stripePaymentIntentId),
    index("payments_order_id_idx").on(t.orderId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    reason: text("reason"),
    stripeRefundId: text("stripe_refund_id"),
    status: refundStatusEnum("status").notNull().default("pending"),
    adminUserId: uuid("admin_user_id"),
    ...timestamps(),
  },
  (t) => [
    index("refunds_payment_id_idx").on(t.paymentId),
    uniqueIndex("refunds_stripe_refund_id_idx").on(t.stripeRefundId),
  ],
);
