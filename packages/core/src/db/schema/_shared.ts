import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Conventions used across the whole schema:
 * - All money values are INTEGER MINOR UNITS (cents) in the row's currency.
 * - Every table gets `id` (uuid) + `created_at` / `updated_at`.
 * - Catalog + customer data is soft-deleted via `deleted_at`.
 */

export const id = () => uuid("id").primaryKey().defaultRandom();

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const softDelete = () => ({
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// ── Enums ────────────────────────────────────────────────────

export const productStatusEnum = pgEnum("product_status", ["draft", "active", "archived"]);

export const orderStatusEnum = pgEnum("order_status", [
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

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
]);

export const cartStatusEnum = pgEnum("cart_status", [
  "active",
  "converted",
  "abandoned",
  "expired",
]);

export const addressTypeEnum = pgEnum("address_type", ["shipping", "billing"]);

export const discountTypeEnum = pgEnum("discount_type", ["percent", "fixed", "free_shipping"]);

export const discountAppliesToEnum = pgEnum("discount_applies_to", [
  "all",
  "products",
  "categories",
]);

export const shippingRateTypeEnum = pgEnum("shipping_rate_type", ["flat", "weight", "price"]);

export const taxModeEnum = pgEnum("tax_mode", ["none", "flat", "stripe_tax"]);

export const reviewStatusEnum = pgEnum("review_status", ["pending", "approved", "rejected"]);

export const giftCardStatusEnum = pgEnum("gift_card_status", ["active", "disabled", "depleted"]);

export const contentStatusEnum = pgEnum("content_status", ["draft", "published"]);

export const webhookStatusEnum = pgEnum("webhook_status", [
  "received",
  "processed",
  "failed",
  "skipped",
]);
