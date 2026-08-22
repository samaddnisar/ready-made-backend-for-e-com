import { notFound, removeAdmin, updateAdminRole, updateAdminSchema, uuidSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const PATCH = withAdminApi(
  { resource: "users", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateAdminSchema);
    // Core guards demoting the last super admin (409 with a clear message).
    await updateAdminRole(id, input.roleId);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "admin_user",
      resourceId: id,
      diff: { after: { roleId: input.roleId } },
    });

    return ok({ updated: true });
  },
);

export const DELETE = withAdminApi(
  { resource: "users", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    // Core guards self-removal (400) and the last super admin (409).
    await removeAdmin(id, admin.adminUser.id);

    await writeAudit({ admin, req, action: "delete", resource: "admin_user", resourceId: id });

    return ok({ deleted: true });
  },
);
