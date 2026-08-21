# Storefront (placeholder)

The storefront is **custom per client** and is intentionally not part of the boilerplate —
this directory only reserves the slot. There is no build/dev script here, so turborepo
skips it entirely.

When starting a client project:

1. Scaffold the client's storefront app here (any stack that can call HTTP APIs;
   if it's TypeScript, import `@repo/api-client` for typed access).
2. Call `GET /api/public/settings` first — it returns the enabled feature list,
   store name and currency. Only build UI for enabled features.
3. All endpoints use the shared envelope: `{ data }` on success,
   `{ error: { code, message, details } }` on failure. `@repo/api-client` unwraps
   it and throws `ApiClientError` for you.
4. Deploy the storefront separately (`<client-domain>`); it talks to the
   backend at `admin.<client-domain>` over HTTP.
