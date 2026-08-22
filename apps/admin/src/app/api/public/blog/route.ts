import { listPublishedPosts, loosePaginationQuerySchema } from "@repo/core";
import { ok, parseQuery, withFeature, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/blog — paginated published posts, newest first.
 * Index cards only (excerpt, never full content). 404s when "cms" is off.
 */
export const GET = withFeature(
  "cms",
  withPublicApi(async (req) => {
    const query = parseQuery(req, loosePaginationQuerySchema);
    return ok(await listPublishedPosts(query), {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  }),
);
