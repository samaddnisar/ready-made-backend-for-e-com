import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { carts } from "./carts";
import { id, timestamps } from "./_shared";
import { orders } from "./orders";
import { productVariants } from "./catalog";

export const inventory = pgTable(
  "inventory",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(0),
    /** Stock held by active checkouts — see inventory_reservations. */
    reservedQty: integer("reserved_qty").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold"),
    trackInventory: boolean("track_inventory").notNull().default(true),
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("inventory_variant_id_idx").on(t.variantId)],
).enableRLS();

/**
 * Row-per-hold so expired reservations can be found and released.
 * Created at checkout start; released on payment failure/expiry;
 * consumed (stock decremented) when the order is paid.
 */
export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("inventory_reservations_variant_id_idx").on(t.variantId),
    index("inventory_reservations_cart_id_idx").on(t.cartId),
    index("inventory_reservations_expires_at_idx").on(t.expiresAt),
  ],
).enableRLS();

/** Manual stock adjustments with a reason, for the audit trail. */
export const inventoryAdjustments = pgTable(
  "inventory_adjustments",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    adminUserId: uuid("admin_user_id"),
    ...timestamps(),
  },
  (t) => [index("inventory_adjustments_variant_id_idx").on(t.variantId)],
).enableRLS();
