import { getPublicProductBySlug, getRelatedProducts } from "@repo/core";
import { ok, withFeature, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/products/:slug/related — manual curation first, then a
 * same-category fallback. 404s entirely when the feature flag is off.
 */
export const GET = withFeature(
  "related_products",
  withPublicApi(async (_req, ctx) => {
    const { slug } = await ctx.params;
    const product = await getPublicProductBySlug(slug!);
    const items = await getRelatedProducts(product.id);
    return ok(
      { items },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  }),
);
