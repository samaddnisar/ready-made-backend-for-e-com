import { adminWishlistSummary, paginationQuerySchema } from "@repo/core";
import { ok, parseQuery, withAdminApi, withFeature } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/wishlists — read-only merchandising summary: total
 * wishlists/saved items + most-wishlisted products. 404s when the
 * wishlists feature flag is off (§4).
 */
export const GET = withFeature(
  "wishlists",
  withAdminApi({ resource: "wishlists", action: "read" }, async (req) => {
    const query = parseQuery(req, paginationQuerySchema);
    return ok(await adminWishlistSummary(query));
  }),
);
