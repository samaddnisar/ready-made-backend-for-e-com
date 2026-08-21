import { getPublicProductBySlug } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/products/:slug — full product detail (variants, images,
 * categories, SEO). Only active, non-deleted products resolve; others 404.
 */
export const GET = withPublicApi(async (_req, ctx) => {
  const { slug } = await ctx.params;
  const product = await getPublicProductBySlug(slug!);
  return ok(product, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
});
