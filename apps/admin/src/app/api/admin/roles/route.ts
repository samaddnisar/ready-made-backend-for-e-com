import { createRole, createRoleSchema, forbidden, isPrivilegedRolePermissions } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "users", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, createRoleSchema);

    // Escalation guard: minting a role that controls user management (or a
    // beyond-read global wildcard) is super-admin-only.
    if (isPrivilegedRolePermissions(input.permissions) && admin.roleName !== "super_admin") {
      throw forbidden("Only a super admin can create a role with these permissions");
    }

    const role = await createRole(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "role",
      resourceId: role.id,
      diff: { after: { name: role.name, permissions: role.permissions } },
    });

    return ok(role);
  },
);
