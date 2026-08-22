import { listNewsletterQuerySchema, listNewsletterSubscribers } from "@repo/core";
import { ok, parseQuery, withAdminApi, withFeature } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/newsletter — paginated subscriber list with q + active
 * filters, plus the global active-subscriber count for the stat card.
 * 404s when the "newsletter" flag is off (§4).
 */
export const GET = withFeature(
  "newsletter",
  withAdminApi({ resource: "newsletter", action: "read" }, async (req) => {
    const query = parseQuery(req, listNewsletterQuerySchema);
    return ok(await listNewsletterSubscribers(query));
  }),
);
