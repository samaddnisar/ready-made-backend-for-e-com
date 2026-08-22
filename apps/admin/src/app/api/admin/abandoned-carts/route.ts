import {
  abandonedCartDetectSchema,
  detectAbandonedCarts,
  listAbandoned,
  listAbandonedCartsQuerySchema,
} from "@repo/core";
import { ok, parseBody, parseQuery, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/abandoned-carts — paginated abandoned carts with email,
 * item count and cart value. 404s when the "abandoned_cart" flag is off (§4).
 */
export const GET = withFeature(
  "abandoned_cart",
  withAdminApi({ resource: "abandoned_carts", action: "read" }, async (req) => {
    const query = parseQuery(req, listAbandonedCartsQuerySchema);
    return ok(await listAbandoned(query));
  }),
);

/**
 * POST /api/admin/abandoned-carts — { action: "detect" }: run abandonment
 * detection now (flags stale active carts with items + a knowable email).
 */
export const POST = withFeature(
  "abandoned_cart",
  withAdminApi({ resource: "abandoned_carts", action: "create" }, async (req, { admin }) => {
    await parseBody(req, abandonedCartDetectSchema);

    const result = await detectAbandonedCarts();

    await writeAudit({
      admin,
      req,
      action: "detect",
      resource: "abandoned_cart",
      diff: { after: { detected: result.detected } },
    });

    return ok(result);
  }),
);
