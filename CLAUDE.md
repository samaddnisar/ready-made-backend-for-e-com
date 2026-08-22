# Claude Code guide

Source of truth: `ecommerce-boilerplate-spec.md`. Build in the phases listed there
(§10); every phase must satisfy the non-functional requirements (§9) before the next.

## Confirmed decisions (do not re-ask)

- ORM: **Drizzle** (not Prisma).
- Services: Supabase (db/auth/storage) + Stripe + Resend, as specced.
- Storefront: **placeholder inside the monorepo** (`apps/storefront`), custom per client.
- Default-ON feature flags for a fresh clone: `reviews`, `related_products`. All other
  toggleable modules default off.

## Phase status

- [x] Phase 1 — Foundation (monorepo, schema + migrations, auth, RBAC, settings +
      feature flags, admin shell)
- [x] Phase 2 — Catalog (products/variants/images, categories, collections, media)
- [x] Phase 3 — Inventory (stock, race-safe reservations, low-stock, PGlite tests)
- [x] Phase 4 — Cart → Checkout → Orders (state machine, Stripe PI + webhooks,
      refunds, order emails, admin orders UI; hardened via adversarial review)
- [x] Phase 5 — Promotions, shipping, tax (stacking discounts, zones/rates,
      flat tax; wired into checkout; admin UIs)
- [x] Phase 6 — Customers (accounts, addresses, order history, LTV, authed API)
- [x] Phase 7 — Dashboard & analytics (revenue/AOV/deltas, SVG chart, top products)
- [x] Phase 8 — Toggleable modules (reviews, wishlists, gift cards, loyalty,
      CMS/blog, abandoned carts, newsletter — all gated end-to-end)
- [x] Phase 9 — Hardening (rate limiting, users/roles + audit log UIs, image
      optimization, privilege-escalation guards, final adversarial review — done)

**Status: all spec phases complete.** Future work lands as incremental
migrations (never regenerate 0000 once any client has cloned).

## Deliberate scope notes

- Gift cards: issuance/validation/ledger only — checkout tender is a later
  enhancement (needs split-payment + zero-total order flow).
- Loyalty: earning only (1 pt per major unit on paid orders); redemption at
  checkout is a later enhancement.
- Tax: none/flat implemented; stripe_tax mode stored but treated as none
  until wired per client (§4 architectural).
- Abandoned-cart detection runs on demand from the admin (Detect now) —
  wire a cron/scheduled invocation per deployment if wanted.

## Architecture rules

- **Money**: integer minor units (cents), always. Never floats.
- **Envelope**: `{ data }` / `{ error: { code, message, details } }` — use `ok()` /
  `fail()` from `apps/admin/src/lib/api.ts`; never hand-roll JSON errors.
- **Admin routes**: always `withAdminApi({ resource, action }, handler)` — it does
  CSRF (same-origin), auth, RBAC, and error mapping. Mutations call `writeAudit(...)`.
- **Feature-scoped routes**: wrap with `withFeature(key, ...)` → 404 when disabled.
  Feature-scoped admin *pages* check `isFeatureEnabled` and `notFound()` when off.
- **Client components must not import `@repo/core` root** (it pulls the postgres
  driver). Client-safe subpaths: `@repo/core/flags`, `@repo/core/errors`,
  `@repo/core/validation`. Keep those free of server-only imports.
- **Validation**: shared Zod schemas live in `packages/core/src/validation/`, strict
  (`.strict()` — reject unknown fields), reused by client + server. Parse with
  `parseBody` / `parseQuery`.
- **DB access**: `getDb()` from `@repo/core`. Route handlers touching the DB need
  `export const dynamic = "force-dynamic"` unless they use cookies/auth already.
- **Order status** transitions only via the state machine in core (Phase 4+);
  every transition writes `order_status_history`.
- **Snapshots**: order items copy title/sku/price at purchase; addresses are jsonb
  snapshots on the order. Never join live catalog data for historical orders.
- **Soft delete** (`deleted_at`) on catalog + customer data — filter it in queries.
  Unique indexes on soft-deletable tables must be **partial**
  (`.where(sql\`deleted_at is null\`)`) so deleted rows release their slug/sku/email.
- **Every new table MUST end with `.enableRLS()`** — the Supabase Data API exposes
  the public schema to anyone with the anon key; RLS default-deny is the shield.
  (The app itself is unaffected: DATABASE_URL connects as table owner.)
- **FK columns get indexes** (§9) — including reverse-lookup columns and the
  second column of composite PKs when queried alone.

## Workflow

- `pnpm typecheck` and `pnpm build` must pass before a phase is done.
  Build needs placeholder env: `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder pnpm build`.
- Schema changes: edit `packages/core/src/db/schema/*`, then `pnpm db:generate`
  (never hand-edit generated SQL in `packages/core/drizzle/`).
- Tests (vitest) target the money paths first: checkout, webhooks, refunds,
  discount math, inventory reservation (§9).
- Update the phase checklist above when a phase lands.
