# E-Commerce Backend + Admin Panel — Boilerplate Spec

**Purpose:** A reusable, fully custom e-commerce backend + admin panel. Built once, kept in a canonical git repo, cloned per client. The storefront is **custom per client and is NOT part of this boilerplate** — but the API it will consume **is** defined here so any custom storefront can wire up cleanly.

**How to use this doc:** This is the source of truth for Claude Code. Build in the phases listed at the end — do **not** try to one-shot the whole thing. Every phase must satisfy the "Non-functional requirements" section before moving on.

---

## 1. Core principles

- **Feature-complete core + toggles.** Isolated features are built in and switched on/off from the admin. Nothing is half-built.
- **Toggles gate at the API layer, not just the UI.** A disabled feature's endpoints must return 404/403. Hiding a button is not security.
- **The storefront stays lean.** Because it's hand-built per client, disabled features simply never get storefront UI — so "everything ships in the backend" costs the customer nothing.
- **Money paths are sacred.** Checkout, payments, refunds, discounts, inventory get tests. These are the paths that can't be audited by eye later, so they get automated safety nets.
- **Type-safe end to end.** Shared types + validation schemas live in one place and are reused by API, admin, and storefront client.

---

## 2. Tech stack & decisions

| Concern | Choice | Notes / swap |
|---|---|---|
| Monorepo | Turborepo + pnpm | Enables shared `core` package across admin + storefront |
| Framework | Next.js (App Router) | Admin app hosts both the UI and the API route handlers |
| Language | TypeScript (strict) | Non-negotiable |
| DB | PostgreSQL (Supabase) | Matches existing stack |
| ORM | Drizzle | Type-safe, light, migration-friendly. *Prisma is the drop-in alternative if preferred* |
| Auth | Supabase Auth | Separate customer vs admin sessions; admin uses RBAC |
| Payments | Stripe (Payment Intents + webhooks) | Optionally Stripe Tax. **Never store card data** |
| Media | Supabase Storage | *Cloudinary/UploadThing alternative* |
| Email | Resend + React Email | Transactional: order confirmation, shipping, etc. |
| Admin UI | shadcn/ui + Tailwind | Components copied into the repo, become our code |
| Validation | Zod | Shared schemas, used on client **and** server |
| Hosting | Vercel (apps) + Supabase (db/auth/storage) | Admin → `admin.<domain>` |

*These are my recommendations — confirm the ones flagged in §12 before building.*

---

## 3. Monorepo structure

```
/
├── packages/
│   ├── core/            # DB schema (Drizzle), business logic/services,
│   │                    # Zod validators, shared TS types, feature-flag helper
│   └── api-client/      # Typed SDK the custom storefront imports to call the API
├── apps/
│   ├── admin/           # Next.js + shadcn: admin UI + backend API routes.
│   │                    # Owns DB, Stripe, auth. Deploys to admin.<domain>
│   └── storefront/      # CUSTOM PER CLIENT — excluded from boilerplate build.
│                        # Placeholder only; consumes @repo/api-client
├── turbo.json
└── package.json
```

The **backend and admin ship as one deployable** (`apps/admin`). The storefront is a separate deployment that talks to it over HTTP via `api-client`.

---

## 4. Feature-flag / toggle system

This is the mechanism the whole "big admin, switch off what you don't need" idea rests on.

- A `settings` table holds a typed `feature_flags` record (e.g. `reviews: true`, `wishlists: false`).
- `core` exposes `isFeatureEnabled(key)` (server) loaded/cached from settings.
- **API middleware** wraps every feature-scoped route: if the flag is off → `404`. This is the security boundary.
- **Admin UI** hides/disables the module's nav + pages when off.
- A **public settings endpoint** (`GET /api/public/settings`) returns the enabled feature list so a custom storefront knows what to render.
- Toggling a feature in the admin flips the flag; no redeploy needed.

**Toggleable features** (isolated → clean on/off): reviews & ratings, wishlists, gift cards, loyalty/points, blog/CMS, abandoned-cart recovery, related/recommended products, newsletter signup.

**Architectural — NOT toggles** (decided per client, up front, because they change how money/data flow through everything): multi-currency, subscriptions/recurring, multi-vendor/marketplace, i18n/multi-language, B2B/wholesale pricing. Build the schema so these are *possible* later, but treat enabling them as a real per-client code change, not a switch.

---

## 5. Data model

Key tables and their important fields. Every table gets `id` (uuid), `created_at`, `updated_at`. Use soft-delete (`deleted_at`) on catalog + customer data.

**Catalog**
- `products` — title, `slug` (unique), description, status (draft/active/archived), **SEO meta** (meta_title, meta_description, og_image), base pricing fields
- `product_variants` — product_id, sku, price, compare_at_price, option values (size/color), weight, barcode
- `product_images` — product_id / variant_id, url, alt, position
- `categories` — name, `slug`, parent_id (nested), SEO meta
- `collections` — curated groups (e.g. "Summer Sale"), manual or rule-based
- `product_categories` / `product_collections` — join tables

**Inventory**
- `inventory` — variant_id, quantity, reserved_qty, low_stock_threshold, track_inventory (bool), allow_backorder (bool)
- Reserve stock at checkout start, release on failure/expiry — handle the race condition.

**Customers**
- `customers` — linked to Supabase Auth user, email, name, marketing_opt_in
- `addresses` — customer_id, type (shipping/billing), full address, is_default

**Cart & checkout**
- `carts` — customer_id (nullable for guests), session token, currency, expires_at
- `cart_items` — cart_id, variant_id, quantity, unit_price snapshot

**Orders**
- `orders` — order_number (human-readable), customer_id, status (see §6), subtotal, discount_total, shipping_total, tax_total, grand_total, currency, shipping_address, billing_address, notes
- `order_items` — order_id, variant_id, title/sku/price **snapshot** (never join live product for historical orders), quantity
- `order_status_history` — order_id, from_status, to_status, actor, timestamp

**Payments**
- `payments` — order_id, stripe_payment_intent_id, amount, status, method
- `refunds` — payment_id, amount, reason, stripe_refund_id, status (support partial refunds)

**Promotions**
- `discounts` — code, type (percent/fixed/free_shipping), value, min_spend, usage_limit, per_customer_limit, starts_at/ends_at, applies_to (all/products/categories), stackable (bool)
- `discount_redemptions` — discount_id, order_id, customer_id

**Shipping & tax**
- `shipping_zones` — name, countries/regions
- `shipping_rates` — zone_id, name, type (flat/weight/price-based), price, conditions
- `tax_settings` — mode (none/flat/stripe_tax), rate, inclusive/exclusive

**Admin & platform**
- `admin_users` — linked to auth, role_id
- `roles` — name, permissions (JSON of resource→actions)
- `settings` — singleton: store info, feature_flags, email config, currency, etc.
- `media` — library of uploaded assets
- `audit_log` — admin_user_id, action, resource, resource_id, diff, timestamp
- `events`/`webhook_log` — inbound Stripe webhooks + outbound events (for idempotency + debugging)

**Toggleable-module tables** (only queried when their flag is on)
- `reviews` — product_id, customer_id, rating, body, status (pending/approved/rejected)
- `wishlists` / `wishlist_items`
- `gift_cards` — code, balance, status
- `loyalty_points` — customer_id, balance, ledger
- `cms_pages` / `blog_posts` — slug, content, SEO meta, status
- `abandoned_carts` — cart_id, reminder_sent_at

---

## 6. Order state machine

```
pending → paid → fulfilled → shipped → delivered → completed
   │         │
   │         └──→ partially_refunded / refunded
   └──→ cancelled / payment_failed
```

- Transitions are enforced in one place in `core` — no ad-hoc status writes.
- Every transition writes to `order_status_history` and can trigger an email.
- Payment success is driven by the **Stripe webhook**, not the client redirect (client can be closed/lost).

---

## 7. Admin panel — feature breakdown

**Always on (core):**
- **Dashboard** — revenue, orders, AOV, top products, low-stock alerts, recent orders, date-range filter
- **Products** — CRUD, variants, image upload/reorder, categories/collections, bulk actions, inline stock edit, draft/publish
- **Orders** — list + filters, detail view, status updates, fulfillment, full/partial refunds, internal notes, printable invoice, timeline
- **Customers** — list, detail, order history, addresses, lifetime value
- **Inventory** — stock levels, low-stock view, adjustments with reason
- **Discounts** — CRUD, usage tracking
- **Shipping** — zones, rates, methods
- **Tax** — settings
- **Settings** — store info, **feature toggles**, email config, currency, payment keys
- **Users & roles** — RBAC management, invite admins
- **Media library**
- **Audit log** — who changed what
- Global: search, pagination, sortable/filterable tables, toast notifications, empty/loading/error states everywhere

**Toggleable modules** (appear in nav only when enabled): Reviews (with moderation queue), Wishlists (read view), Gift cards, Loyalty, Blog/CMS editor, Abandoned-cart view, Newsletter list.

---

## 8. API surface

Two groups, all under `apps/admin`:

**Admin API** (`/api/admin/*`) — auth + RBAC required on every route. Full CRUD over every resource above.

**Public storefront API** (`/api/public/*`) — what a custom storefront consumes via `@repo/api-client`:
- `GET /products`, `GET /products/:slug`, `GET /categories`, `GET /collections/:slug`
- `GET /settings` (enabled features, store info, currency)
- `POST /cart`, `GET /cart/:id`, `PATCH /cart/:id/items`
- `POST /checkout` → creates Stripe Payment Intent, returns client secret
- `POST /webhooks/stripe` (signature-verified)
- `GET /customer/me`, `GET /customer/orders` (authed)
- Feature-scoped (only when flag on): `POST /reviews`, `GET /products/:id/reviews`, wishlist endpoints, gift-card validation, etc.

All responses share one envelope: `{ data }` on success, `{ error: { code, message, details } }` on failure.

---

## 9. Non-functional requirements (build these in, always)

**Security**
- Zod validation on **every** endpoint input; reject unknown fields.
- Input sanitization; output encoding to prevent XSS. Parameterized queries only (ORM handles it) → no SQLi.
- Auth on every admin route; **RBAC checked server-side**, never trust the client.
- Feature flags gated at the API (disabled feature → 404).
- Rate limiting on public + auth endpoints (login, checkout, review submit).
- CSRF protection on state-changing requests; secure + httpOnly cookies.
- Stripe **webhook signature verification** + **idempotency keys** on payment operations.
- Secrets in env only; never in client bundle or logs. Secure response headers (CSP, HSTS, etc.).
- Full audit log of admin mutations.

**Validation & errors**
- Shared Zod schemas (client + server). Consistent error envelope. Graceful failures with clear toasts in admin.

**Performance**
- Pagination on all lists (never load-all). DB indexes on FKs, slugs, statuses, search columns.
- Avoid N+1; batch queries. Cache read-heavy public endpoints (products, settings).
- Background jobs for emails, exports, abandoned-cart reminders. Optimistic UI in admin.
- Image optimization for media.

**SEO support** (admin itself is `noindex`, behind auth) — products/categories/collections carry slugs + meta fields + sitemap-ready data so custom storefronts can rank.

**Testing** — automated tests on the money paths: checkout, payment webhook handling, refunds (incl. partial), discount math, inventory reservation/race. These are the non-negotiable safety net.

**404 / edge cases** — proper 404s, empty states, expired carts, out-of-stock at checkout, failed payments, duplicate webhooks, concurrent stock decrements.

---

## 10. Build order (phases)

Build and verify each phase (against §9) before the next. Each is a vertical slice.

1. **Foundation** — monorepo, Drizzle schema + migrations, Supabase auth, RBAC, settings + feature-flag system, admin shell (nav, layout, auth-gated).
2. **Catalog** — products/variants/images/categories/collections + admin CRUD + media library.
3. **Inventory** — stock tracking, reservations, low-stock alerts.
4. **Cart → Checkout → Orders** — cart API, Stripe Payment Intents, webhook-driven order creation, order state machine, order emails.
5. **Promotions, shipping, tax** — discounts (with stacking rules), shipping zones/rates, tax settings.
6. **Customers** — accounts, addresses, order history, public customer API.
7. **Dashboard & analytics.**
8. **Toggleable modules** — one at a time (reviews → wishlists → gift cards → loyalty → CMS → abandoned cart), each fully gated by its flag.
9. **Hardening** — rate limiting, audit log polish, error states, tests on money paths, security pass.

---

## 11. Per-client checklist (each time you clone)

1. `git clone` the canonical repo (don't copy the folder — clone, so core fixes can be pulled later).
2. New Supabase project + env vars; run migrations.
3. Set store info + currency; **toggle features** for this client in admin settings.
4. Decide architectural features (multi-currency, subscriptions, etc.) up front — these are code, not toggles.
5. Connect Stripe (client's account).
6. Build the **custom storefront** against `@repo/api-client`, implementing UI only for enabled features.
7. Deploy: backend+admin → `admin.<client-domain>`, storefront → `<client-domain>`.

---

## 12. Confirm before building

- **Drizzle vs Prisma?** (spec assumes Drizzle)
- **Supabase for db + auth + storage + Stripe for payments + Resend for email** — all good?
- **Does the storefront live in this monorepo** (as a per-client app you swap) **or a separate repo per client** that just installs `@repo/api-client`?
- **Any feature you already know is always-on or always-off** for the kind of clients you get? (lets us set sensible defaults)
