import { getPublishedPage } from "@repo/core";
import { ok, withFeature, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/pages/:slug — a published CMS page. Drafts and deleted
 * pages 404; the whole route 404s when the "cms" flag is off (§4).
 */
export const GET = withFeature(
  "cms",
  withPublicApi(async (_req, ctx) => {
    const { slug } = await ctx.params;
    const page = await getPublishedPage(slug!);
    return ok(page, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  }),
);
