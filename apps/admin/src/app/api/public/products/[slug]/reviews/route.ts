import { listPublicReviews, loosePaginationQuerySchema } from "@repo/core";
import { ok, parseQuery, withFeature, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/products/:slug/reviews — approved reviews for a live
 * product plus the rating summary (average + count). 404s entirely when
 * the reviews feature is off.
 */
export const GET = withFeature(
  "reviews",
  withPublicApi(async (req, ctx) => {
    const { slug } = await ctx.params;
    const query = parseQuery(req, loosePaginationQuerySchema);
    return ok(await listPublicReviews(slug!, query), {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  }),
);
