import { getPublishedPost } from "@repo/core";
import { ok, withFeature, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/blog/:slug — a published post with full content.
 * Drafts and deleted posts 404; the whole route 404s when "cms" is off (§4).
 */
export const GET = withFeature(
  "cms",
  withPublicApi(async (_req, ctx) => {
    const { slug } = await ctx.params;
    const post = await getPublishedPost(slug!);
    return ok(post, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  }),
);
