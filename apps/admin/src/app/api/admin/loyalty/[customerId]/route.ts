import {
  adjustLoyaltySchema,
  adminAdjustLoyalty,
  adminGetLoyaltyDetail,
  notFound,
  paginationQuerySchema,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, parseQuery, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/admin/loyalty/:customerId — customer identity + balance + paginated ledger. */
export const GET = withFeature(
  "loyalty",
  withAdminApi({ resource: "loyalty", action: "read" }, async (req, { params }) => {
    const { customerId } = await params;
    if (!customerId || !uuidSchema.safeParse(customerId).success) throw notFound();
    const query = parseQuery(req, paginationQuerySchema);
    return ok(await adminGetLoyaltyDetail(customerId, query));
  }),
);

/** POST /api/admin/loyalty/:customerId — manual points adjustment (±, reason required). */
export const POST = withFeature(
  "loyalty",
  withAdminApi({ resource: "loyalty", action: "update" }, async (req, { params, admin }) => {
    const { customerId } = await params;
    if (!customerId || !uuidSchema.safeParse(customerId).success) throw notFound();
    const input = await parseBody(req, adjustLoyaltySchema);

    const result = await adminAdjustLoyalty(
      customerId,
      input.delta,
      input.reason,
      admin.adminUser.id,
    );

    await writeAudit({
      admin,
      req,
      action: "adjust",
      resource: "loyalty_account",
      resourceId: customerId,
      diff: { after: { delta: input.delta, reason: input.reason, balance: result.balance } },
    });

    return ok(result);
  }),
);
