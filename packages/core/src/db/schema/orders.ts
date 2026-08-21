import {
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, orderStatusEnum, timestamps } from "./_shared";
import { customers } from "./customers";
import { productVariants } from "./catalog";

/** Human-readable order numbers: ORD-1001, ORD-1002, … */
export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 1001 });

/** Address snapshot embedded on the order — never joined live. */
export type OrderAddress = {
  firstName?: string;
  lastName?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
};

export const orders = pgTable(
  "orders",
  {
    id: id(),
    orderNumber: text("order_number").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Always set — guest orders have no customer account but do have an email. */
    email: text("email").notNull(),
    status: orderStatusEnum("status").notNull().default("pending"),
    subtotal: integer("subtotal").notNull(),
    discountTotal: integer("discount_total").notNull().default(0),
    shippingTotal: integer("shipping_total").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    grandTotal: integer("grand_total").notNull(),
    currency: text("currency").notNull(),
    shippingAddress: jsonb("shipping_address").$type<OrderAddress>(),
    billingAddress: jsonb("billing_address").$type<OrderAddress>(),
    shippingRateName: text("shipping_rate_name"),
    discountCode: text("discount_code"),
    /** Internal admin notes — never shown to the customer. */
    notes: text("notes"),
    cartId: uuid("cart_id"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("orders_order_number_idx").on(t.orderNumber),
    index("orders_customer_id_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
    index("orders_email_idx").on(t.email),
    index("orders_created_at_idx").on(t.createdAt),
  ],
).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Kept for traceability, but title/sku/price are snapshots — never join live. */
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title"),
    sku: text("sku"),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    imageUrl: text("image_url"),
    ...timestamps(),
  },
  (t) => [index("order_items_order_id_idx").on(t.orderId)],
).enableRLS();

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatusEnum("from_status"),
    toStatus: orderStatusEnum("to_status").notNull(),
    /** "system", "webhook:stripe", or an admin user id. */
    actor: text("actor").notNull(),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [index("order_status_history_order_id_idx").on(t.orderId)],
).enableRLS();
