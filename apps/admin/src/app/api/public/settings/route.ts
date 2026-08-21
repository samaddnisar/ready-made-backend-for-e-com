import { getEnabledFeatures, getSettings } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";

// Reads the DB per request; CDN caching comes from the Cache-Control header.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/settings — store info + enabled feature list (§4).
 * A custom storefront calls this to decide what UI to render.
 */
export const GET = withPublicApi(async () => {
  const [settings, features] = await Promise.all([getSettings(), getEnabledFeatures()]);
  return ok(
    {
      storeName: settings.storeName,
      currency: settings.currency,
      logoUrl: settings.logoUrl,
      features,
    },
    // Cached at the edge; settings changes propagate within a minute.
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
});
