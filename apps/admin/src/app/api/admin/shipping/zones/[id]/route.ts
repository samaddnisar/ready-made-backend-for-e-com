import {
  deleteShippingZone,
  notFound,
  updateShippingZone,
  updateShippingZoneSchema,
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
    const input = await parseBody(req, updateShippingZoneSchema);
    const zone = await updateShippingZone(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "shipping_zone",
      resourceId: id,
      diff: { after: input },
    });

    return ok(zone);
  },
);

export const DELETE = withAdminApi(
  { resource: "shipping", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    await deleteShippingZone(id);

    await writeAudit({ admin, req, action: "delete", resource: "shipping_zone", resourceId: id });

    return ok({ deleted: true });
  },
);
