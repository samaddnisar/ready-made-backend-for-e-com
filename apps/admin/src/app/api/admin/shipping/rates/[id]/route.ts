import {
  deleteShippingRate,
  notFound,
  updateShippingRate,
  updateShippingRateSchema,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const PATCH = withAdminApi(
  { resource: "shipping", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateShippingRateSchema);
    const rate = await updateShippingRate(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "shipping_rate",
      resourceId: id,
      diff: { after: input },
    });

    return ok(rate);
  },
);

export const DELETE = withAdminApi(
  { resource: "shipping", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    await deleteShippingRate(id);

    await writeAudit({ admin, req, action: "delete", resource: "shipping_rate", resourceId: id });

    return ok({ deleted: true });
  },
);
