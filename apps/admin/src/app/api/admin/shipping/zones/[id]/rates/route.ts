import {
  createShippingRate,
  createShippingRateSchema,
  notFound,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "shipping", action: "create" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, createShippingRateSchema);
    const rate = await createShippingRate(id, input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "shipping_rate",
      resourceId: rate.id,
      diff: { after: { name: rate.name, type: rate.type, price: rate.price, zoneId: id } },
    });

    return ok(rate);
  },
);
