import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cartStatusEnum, id, timestamps } from "./_shared";
import { customers } from "./customers";
import { productVariants } from "./catalog";

export const carts = pgTable(
  "carts",
  {
    id: id(),
    /** Null for guest carts — identified by sessionToken instead. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Opaque token stored in the storefront's cookie for guest carts. */
    sessionToken: text("session_token").notNull(),
    status: cartStatusEnum("status").notNull().default("active"),
    /** ISO 4217, e.g. "USD". */
    currency: text("currency").notNull(),
    discountCode: text("discount_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("carts_session_token_idx").on(t.sessionToken),
    index("carts_customer_id_idx").on(t.customerId),
    index("carts_status_idx").on(t.status),
    index("carts_expires_at_idx").on(t.expiresAt),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    /** Price (minor units) at the time the item was added. */
    unitPrice: integer("unit_price").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("cart_items_cart_id_idx").on(t.cartId),
    uniqueIndex("cart_items_cart_variant_idx").on(t.cartId, t.variantId),
  ],
);
