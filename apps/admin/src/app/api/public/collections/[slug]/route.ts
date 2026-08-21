import {
  getPublicCollectionBySlug,
  listPublicProducts,
  publicListProductsQuerySchema,
} from "@repo/core";
import { ok, parseQuery, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/collections/:slug — collection metadata plus a paginated
 * page of its active products (same query params as /api/public/products).
 */
export const GET = withPublicApi(async (req, ctx) => {
  const { slug } = await ctx.params;
  const query = parseQuery(req, publicListProductsQuerySchema);
  const [collection, products] = await Promise.all([
    getPublicCollectionBySlug(slug!),
    listPublicProducts({ ...query, collection: slug! }),
  ]);
  return ok(
    { collection, products },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
});
