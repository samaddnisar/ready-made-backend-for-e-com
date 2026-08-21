# E-Commerce Backend + Admin Panel (Boilerplate)

A reusable, fully custom e-commerce backend + admin panel. Built once, kept in this
canonical repo, **cloned per client**. The storefront is custom per client and is NOT
part of this boilerplate — but the public API it consumes is defined here, with a typed
SDK (`@repo/api-client`) so any custom storefront wires up cleanly.

The full product spec lives in [ecommerce-boilerplate-spec.md](./ecommerce-boilerplate-spec.md).

## Stack

Turborepo + pnpm · Next.js (App Router) · TypeScript (strict) · PostgreSQL (Supabase) ·
Drizzle ORM · Supabase Auth · Stripe (Payment Intents + webhooks) · Supabase Storage ·
Resend + React Email · shadcn/ui + Tailwind · Zod · Vercel + Supabase hosting.

## Layout

```
packages/core        DB schema (Drizzle), business logic, Zod validators,
                     shared types, feature flags, RBAC
packages/api-client  Typed SDK the custom storefront imports
apps/admin           Admin UI + ALL API routes (admin + public). One deployable.
apps/storefront      Placeholder — custom per client, excluded from the build
```

## Getting started

```bash
pnpm install
cp .env.example .env        # fill in Supabase + Stripe + Resend credentials
pnpm db:migrate             # apply migrations to the database
pnpm db:seed                # system roles + settings singletons
pnpm dev                    # admin at http://localhost:3000
```

To create the first admin: create the user in Supabase Auth (dashboard → Authentication),
then re-run `pnpm db:seed` with `SEED_ADMIN_EMAIL=<email> SEED_ADMIN_AUTH_USER_ID=<auth uuid>`.

## Conventions

- **Money** is always integer minor units (cents) in the row's currency.
- **API envelope**: `{ data }` on success, `{ error: { code, message, details } }` on failure.
- **Feature flags** live in the `settings` row, toggled from the admin — a disabled
  feature's endpoints return 404 (gated in the API, not just the UI).
- **RBAC** is enforced server-side on every admin route via `withAdminApi`.
- **Order status** changes go through the state machine in `@repo/core` only.
- Snapshots, not joins, for anything historical (order items, addresses).

## Per-client checklist

1. `git clone` this repo (clone — don't copy — so core fixes can be pulled later).
2. New Supabase project; set env vars; `pnpm db:migrate && pnpm db:seed`.
3. Set store info + currency; toggle features for this client in admin Settings.
4. Decide architectural features up front (multi-currency, subscriptions, marketplace,
   i18n, B2B) — these are code changes, not toggles.
5. Connect the client's Stripe account (+ webhook endpoint `/api/webhooks/stripe`).
6. Build the custom storefront against `@repo/api-client`, UI only for enabled features.
7. Deploy: backend+admin → `admin.<client-domain>`, storefront → `<client-domain>`.
