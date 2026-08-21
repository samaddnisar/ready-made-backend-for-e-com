import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { discountAppliesToEnum, discountTypeEnum, id, timestamps } from "./_shared";
import { categories, products } from "./catalog";
import { customers } from "./customers";
import { orders } from "./orders";

export const discounts = pgTable(
  "discounts",
  {
    id: id(),
    code: text("code").notNull(),
    type: discountTypeEnum("type").notNull(),
    /** percent: 0–100; fixed: minor units; free_shipping: ignored. */
    value: integer("value").notNull().default(0),
    minSpend: integer("min_spend"),
    usageLimit: integer("usage_limit"),
    perCustomerLimit: integer("per_customer_limit"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    appliesTo: discountAppliesToEnum("applies_to").notNull().default("all"),
    stackable: boolean("stackable").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("discounts_code_idx").on(t.code), index("discounts_active_idx").on(t.isActive)],
);

export const discountProducts = pgTable(
  "discount_products",
  {
    discountId: uuid("discount_id")
      .notNull()
      .references(() => discounts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.discountId, t.productId] })],
);

export const discountCategories = pgTable(
  "discount_categories",
  {
    discountId: uuid("discount_id")
      .notNull()
      .references(() => discounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.discountId, t.categoryId] })],
);

export const discountRedemptions = pgTable(
  "discount_redemptions",
  {
    id: id(),
    discountId: uuid("discount_id")
      .notNull()
      .references(() => discounts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("discount_redemptions_discount_id_idx").on(t.discountId),
    index("discount_redemptions_customer_id_idx").on(t.customerId),
    uniqueIndex("discount_redemptions_order_idx").on(t.discountId, t.orderId),
  ],
);
