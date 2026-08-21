import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps, webhookStatusEnum } from "./_shared";
import type { FeatureFlags } from "../../features/flags";
import type { RolePermissions } from "../../rbac/index";

export const roles = pgTable(
  "roles",
  {
    id: id(),
    name: text("name").notNull(),
    /** resource → allowed actions; "*" wildcards supported. See rbac/. */
    permissions: jsonb("permissions").$type<RolePermissions>().notNull().default({}),
    /** Built-in roles (super_admin, …) can't be deleted from the UI. */
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("roles_name_idx").on(t.name)],
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: id(),
    /** Supabase Auth user id. */
    authUserId: uuid("auth_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("admin_users_auth_user_id_idx").on(t.authUserId),
    uniqueIndex("admin_users_email_idx").on(t.email),
  ],
);

export type StoreAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export type EmailConfig = {
  fromName?: string;
  /** Overrides EMAIL_FROM env when set. */
  fromAddress?: string;
  replyTo?: string;
};

/** Singleton — one row, fixed primary key, upserted by the settings service. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  storeName: text("store_name").notNull().default("My Store"),
  storeEmail: text("store_email"),
  storePhone: text("store_phone"),
  storeAddress: jsonb("store_address").$type<StoreAddress>(),
  logoUrl: text("logo_url"),
  /** ISO 4217 store currency, e.g. "USD". */
  currency: text("currency").notNull().default("USD"),
  featureFlags: jsonb("feature_flags").$type<FeatureFlags>().notNull().default({} as FeatureFlags),
  emailConfig: jsonb("email_config").$type<EmailConfig>(),
  ...timestamps(),
});

export const media = pgTable(
  "media",
  {
    id: id(),
    /** Public URL (Supabase Storage). */
    url: text("url").notNull(),
    /** Storage object path — needed for deletion. */
    storagePath: text("storage_path").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    alt: text("alt"),
    width: integer("width"),
    height: integer("height"),
    uploadedBy: uuid("uploaded_by"),
    ...timestamps(),
  },
  (t) => [index("media_mime_type_idx").on(t.mimeType)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    adminUserId: uuid("admin_user_id"),
    /** e.g. "create", "update", "delete", "refund", "toggle_feature". */
    action: text("action").notNull(),
    /** e.g. "product", "order", "settings". */
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    /** { before, after } — trimmed to changed fields. */
    diff: jsonb("diff").$type<{ before?: unknown; after?: unknown }>(),
    ip: text("ip"),
    ...timestamps(),
  },
  (t) => [
    index("audit_log_admin_user_id_idx").on(t.adminUserId),
    index("audit_log_resource_idx").on(t.resource, t.resourceId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ],
);

/** Inbound webhook log — idempotency guard + debugging. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    source: text("source").notNull().default("stripe"),
    /** Provider's event id (evt_…) — unique so duplicates are rejected. */
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    status: webhookStatusEnum("status").notNull().default("received"),
    error: text("error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("webhook_events_source_event_id_idx").on(t.source, t.eventId),
    index("webhook_events_type_idx").on(t.type),
  ],
);
