import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  forbidden,
  getDb,
  hasPermission,
  schema,
  unauthorized,
  type Action,
  type Resource,
  type RolePermissions,
} from "@repo/core";
import { createSupabaseServerClient } from "./supabase/server";

export type AdminContext = {
  authUserId: string;
  adminUser: typeof schema.adminUsers.$inferSelect;
  roleName: string;
  permissions: RolePermissions;
};

type AdminResolution =
  | { status: "no_session" }
  | { status: "not_admin" }
  | { status: "ok"; context: AdminContext };

/**
 * Resolve the signed-in admin (session → admin_users row → role).
 * Cached per request. "not_admin" means a valid Supabase session whose
 * auth user has no admin_users row (e.g. a customer account).
 */
const resolveAdmin = cache(async (): Promise<AdminResolution> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "no_session" };

  const db = getDb();
  const row = await db.query.adminUsers.findFirst({
    where: eq(schema.adminUsers.authUserId, user.id),
    with: { role: true },
  });
  if (!row) return { status: "not_admin" };

  return {
    status: "ok",
    context: {
      authUserId: user.id,
      adminUser: row,
      roleName: row.role.name,
      permissions: row.role.permissions,
    },
  };
});

export async function getAdminContext(): Promise<AdminContext | null> {
  const resolution = await resolveAdmin();
  return resolution.status === "ok" ? resolution.context : null;
}

/** For route handlers — throws AppError (mapped to the JSON envelope). */
export async function requireAdmin(): Promise<AdminContext> {
  const resolution = await resolveAdmin();
  if (resolution.status === "no_session") throw unauthorized();
  if (resolution.status === "not_admin") throw forbidden();
  return resolution.context;
}

export async function requirePermission(resource: Resource, action: Action): Promise<AdminContext> {
  const ctx = await requireAdmin();
  if (!hasPermission(ctx.permissions, resource, action)) throw forbidden();
  return ctx;
}

/**
 * For server components/pages — redirects instead of throwing.
 * A signed-in user WITHOUT an admin_users row goes to /unauthorized
 * (never back to /login — middleware bounces authed users off /login,
 * which would loop forever).
 */
export async function requireAdminPage(): Promise<AdminContext> {
  const resolution = await resolveAdmin();
  if (resolution.status === "no_session") redirect("/login");
  if (resolution.status === "not_admin") redirect("/unauthorized");
  return resolution.context;
}

export function can(ctx: AdminContext, resource: Resource, action: Action): boolean {
  return hasPermission(ctx.permissions, resource, action);
}

/**
 * Page guard: signed-in admin with `read` on the resource, else 404
 * (404 rather than 403 so the page's existence isn't leaked).
 */
export async function requireReadPage(resource: Resource): Promise<AdminContext> {
  const ctx = await requireAdminPage();
  if (!hasPermission(ctx.permissions, resource, "read")) notFound();
  return ctx;
}
