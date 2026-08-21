import { listPublicCategories } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/categories — flat category list for storefront nav
 * (tree assembled by the caller via parentId), with active-product counts.
 */
export const GET = withPublicApi(async () => {
  const categories = await listPublicCategories();
  return ok(categories, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
});
