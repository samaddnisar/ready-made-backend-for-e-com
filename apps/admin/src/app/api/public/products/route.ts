import { listPublicProducts, publicListProductsQuerySchema } from "@repo/core";
import { ok, parseQuery, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/products — paginated active products for the storefront.
 * Drafts, archived and soft-deleted products are filtered by the service.
 */
export const GET = withPublicApi(async (req) => {
  const query = parseQuery(req, publicListProductsQuerySchema);
  const result = await listPublicProducts(query);
  return ok(result, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
});
