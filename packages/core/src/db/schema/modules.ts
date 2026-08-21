import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  contentStatusEnum,
  giftCardStatusEnum,
  id,
  reviewStatusEnum,
  softDelete,
  timestamps,
} from "./_shared";
import { carts } from "./carts";
import { customers } from "./customers";
import { orders } from "./orders";
import { products, productVariants } from "./catalog";

// ── Reviews (feature: reviews) ───────────────────────────────

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Set when the review comes from a verified purchase. */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body"),
    status: reviewStatusEnum("status").notNull().default("pending"),
    ...timestamps(),
  },
  (t) => [
    index("reviews_product_id_idx").on(t.productId),
    index("reviews_status_idx").on(t.status),
    index("reviews_order_id_idx").on(t.orderId),
    uniqueIndex("reviews_customer_product_idx").on(t.customerId, t.productId),
  ],
).enableRLS();

// ── Wishlists (feature: wishlists) ───────────────────────────

export const wishlists = pgTable(
  "wishlists",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Wishlist"),
    ...timestamps(),
  },
  (t) => [index("wishlists_customer_id_idx").on(t.customerId)],
).enableRLS();

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: id(),
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("wishlist_items_wishlist_id_idx").on(t.wishlistId),
    index("wishlist_items_variant_id_idx").on(t.variantId),
    uniqueIndex("wishlist_items_unique_idx").on(t.wishlistId, t.productId),
  ],
).enableRLS();

// ── Gift cards (feature: gift_cards) ─────────────────────────

export const giftCards = pgTable(
  "gift_cards",
  {
    id: id(),
    code: text("code").notNull(),
    initialBalance: integer("initial_balance").notNull(),
    balance: integer("balance").notNull(),
    currency: text("currency").notNull(),
    status: giftCardStatusEnum("status").notNull().default("active"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("gift_cards_code_idx").on(t.code),
    index("gift_cards_customer_id_idx").on(t.customerId),
  ],
).enableRLS();

/** Money-path ledger: every balance change is a row. */
export const giftCardTransactions = pgTable(
  "gift_card_transactions",
  {
    id: id(),
    giftCardId: uuid("gift_card_id")
      .notNull()
      .references(() => giftCards.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    /** Negative = spend, positive = load/refund. Minor units. */
    delta: integer("delta").notNull(),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    index("gift_card_transactions_gift_card_id_idx").on(t.giftCardId),
    index("gift_card_transactions_order_id_idx").on(t.orderId),
  ],
).enableRLS();

// ── Loyalty (feature: loyalty) ───────────────────────────────

export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("loyalty_accounts_customer_id_idx").on(t.customerId)],
).enableRLS();

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    /** Points delta: positive = earned, negative = redeemed/expired. */
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("loyalty_ledger_account_id_idx").on(t.accountId),
    index("loyalty_ledger_order_id_idx").on(t.orderId),
  ],
).enableRLS();

// ── CMS / Blog (feature: cms) ────────────────────────────────

export const cmsPages = pgTable(
  "cms_pages",
  {
    id: id(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    content: text("content"),
    status: contentStatusEnum("status").notNull().default("draft"),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    ogImageUrl: text("og_image_url"),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("cms_pages_slug_idx").on(t.slug).where(sql`deleted_at is null`),
    index("cms_pages_status_idx").on(t.status),
  ],
).enableRLS();

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: id(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    content: text("content"),
    coverImageUrl: text("cover_image_url"),
    status: contentStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    authorAdminUserId: uuid("author_admin_user_id"),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    ogImageUrl: text("og_image_url"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("blog_posts_slug_idx").on(t.slug).where(sql`deleted_at is null`),
    index("blog_posts_status_idx").on(t.status),
  ],
).enableRLS();

// ── Abandoned carts (feature: abandoned_cart) ────────────────

export const abandonedCarts = pgTable(
  "abandoned_carts",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    email: text("email"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    recoveryOrderId: uuid("recovery_order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("abandoned_carts_cart_id_idx").on(t.cartId),
    index("abandoned_carts_recovery_order_id_idx").on(t.recoveryOrderId),
  ],
).enableRLS();

// ── Newsletter (feature: newsletter) ─────────────────────────

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: id(),
    email: text("email").notNull(),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    /** e.g. "storefront_footer", "checkout". */
    source: text("source"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("newsletter_subscribers_email_idx").on(t.email)],
).enableRLS();
