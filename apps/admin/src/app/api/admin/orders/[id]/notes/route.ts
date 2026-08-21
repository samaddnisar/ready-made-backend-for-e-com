import { notFound, updateOrderNotes, updateOrderNotesSchema, uuidSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const PATCH = withAdminApi(
  { resource: "orders", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateOrderNotesSchema);

    await updateOrderNotes(id, input.notes);

    await writeAudit({
      admin,
      req,
      action: "update_notes",
      resource: "order",
      resourceId: id,
      diff: { after: { notes: input.notes } },
    });

    return ok({ updated: true });
  },
);
