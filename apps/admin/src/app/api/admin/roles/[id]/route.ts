import { deleteRole, notFound, updateRole, updateRoleSchema, uuidSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const PATCH = withAdminApi(
  { resource: "users", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateRoleSchema);
    // Core rejects edits to built-in roles (409 with a clear message).
    const role = await updateRole(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "role",
      resourceId: id,
      diff: { after: input },
    });

    return ok(role);
  },
);

export const DELETE = withAdminApi(
  { resource: "users", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    // Core rejects deleting built-in roles and roles that still have members (409).
    await deleteRole(id);

    await writeAudit({ admin, req, action: "delete", resource: "role", resourceId: id });

    return ok({ deleted: true });
  },
);
