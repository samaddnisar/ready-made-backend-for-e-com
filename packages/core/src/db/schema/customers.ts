import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { addressTypeEnum, id, softDelete, timestamps } from "./_shared";

export const customers = pgTable(
  "customers",
  {
    id: id(),
    /** Supabase Auth user id — null for guest-checkout customers. */
    authUserId: uuid("auth_user_id"),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    notes: text("notes"),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("customers_email_idx").on(t.email),
    uniqueIndex("customers_auth_user_id_idx").on(t.authUserId),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    type: addressTypeEnum("type").notNull().default("shipping"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    region: text("region"),
    postalCode: text("postal_code").notNull(),
    /** ISO 3166-1 alpha-2, e.g. "US". */
    country: text("country").notNull(),
    phone: text("phone"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [index("addresses_customer_id_idx").on(t.customerId)],
);
