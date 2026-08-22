import { createRole, createRoleSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "users", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, createRoleSchema);
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
