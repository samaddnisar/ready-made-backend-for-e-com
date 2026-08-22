import {
  createShippingZone,
  createShippingZoneSchema,
  listShippingZones,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "shipping", action: "read" }, async () => {
  return ok(await listShippingZones());
});

export const POST = withAdminApi(
  { resource: "shipping", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, createShippingZoneSchema);
    const zone = await createShippingZone(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "shipping_zone",
      resourceId: zone.id,
      diff: { after: { name: zone.name, countries: zone.countries } },
    });

    return ok(zone);
  },
);
