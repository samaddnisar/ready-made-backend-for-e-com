import { listReviewsAdmin, listReviewsQuerySchema } from "@repo/core";
import { ok, parseQuery, withAdminApi, withFeature } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/admin/reviews — moderation queue (status filter + product-title search). */
export const GET = withFeature(
  "reviews",
  withAdminApi({ resource: "reviews", action: "read" }, async (req) => {
    const query = parseQuery(req, listReviewsQuerySchema);
    return ok(await listReviewsAdmin(query));
  }),
);
