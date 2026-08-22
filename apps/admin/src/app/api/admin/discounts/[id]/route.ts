import {
  deleteDiscount,
  getDiscountDetail,
  notFound,
  updateDiscount,
  updateDiscountSchema,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi(
  { resource: "discounts", action: "read" },
  async (_req, { params }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    return ok(await getDiscountDetail(id));
  },
);

export const PATCH = withAdminApi(
  { resource: "discounts", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateDiscountSchema);
    const discount = await updateDiscount(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "discount",
      resourceId: id,
      diff: { after: input },
    });

    return ok(discount);
  },
);

export const DELETE = withAdminApi(
  { resource: "discounts", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    await deleteDiscount(id);

    await writeAudit({ admin, req, action: "delete", resource: "discount", resourceId: id });

    return ok({ deleted: true });
  },
);
