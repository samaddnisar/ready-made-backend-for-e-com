import {
  addAdminUser,
  badRequest,
  inviteAdminSchema,
  listAdminUsers,
  listRoles,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "users", action: "read" }, async () => {
  return ok({ admins: await listAdminUsers(), roles: await listRoles() });
});

/**
 * Resolve (or create) the Supabase auth user for an invite. The happy path
 * sends the invite email via Supabase; if the auth user already exists
 * (e.g. an existing customer account being promoted to admin), fall back
 * to looking them up by email.
 */
async function resolveAuthUserId(email: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const invited = await supabase.auth.admin.inviteUserByEmail(email);
  if (!invited.error && invited.data.user) return invited.data.user.id;

  const normalized = email.toLowerCase();
  const perPage = 200;
  // Defensive pagination: stores rarely exceed a page of auth users, but
  // don't assume — scan up to 5 pages before giving up.
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const match = data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (match) return match.id;
    if (data.users.length < perPage) break;
  }

  throw badRequest(
    `Couldn't invite ${email}: ${invited.error?.message ?? "the auth user could not be created"}`,
  );
}

export const POST = withAdminApi(
  { resource: "users", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, inviteAdminSchema);
    const authUserId = await resolveAuthUserId(input.email);
    const row = await addAdminUser({
      email: input.email,
      authUserId,
      roleId: input.roleId,
      name: input.name,
    });

    await writeAudit({
      admin,
      req,
      action: "invite",
      resource: "admin_user",
      resourceId: row.id,
      diff: { after: { email: row.email, roleId: row.roleId, name: row.name } },
    });

    return ok(row);
  },
);
