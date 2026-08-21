import { adminTransitionOrder, notFound, updateOrderStatusSchema, uuidSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { sendOrderEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "orders", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateOrderStatusSchema);

    const result = await adminTransitionOrder(id, input, admin.adminUser.id);
    if (result.email) await sendOrderEmail(result.email, id);

    await writeAudit({
      admin,
      req,
      action: "transition",
      resource: "order",
      resourceId: id,
      diff: { after: { status: input.status } },
    });

    return ok(result.order);
  },
);
