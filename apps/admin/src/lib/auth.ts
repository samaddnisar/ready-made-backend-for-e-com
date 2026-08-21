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

/**
 * Resolve the signed-in admin (session → admin_users row → role).
 * Cached per request. Returns null when there's no session or the
 * auth user has no admin_users row (i.e. a customer account).
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const db = getDb();
  const row = await db.query.adminUsers.findFirst({
    where: eq(schema.adminUsers.authUserId, user.id),
    with: { role: true },
  });
  if (!row) return null;

  return {
    authUserId: user.id,
    adminUser: row,
    roleName: row.role.name,
    permissions: row.role.permissions,
  };
});

/** For route handlers — throws AppError (mapped to the JSON envelope). */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) throw unauthorized();
  return ctx;
}

export async function requirePermission(resource: Resource, action: Action): Promise<AdminContext> {
  const ctx = await requireAdmin();
  if (!hasPermission(ctx.permissions, resource, action)) throw forbidden();
  return ctx;
}

/** For server components/pages — redirects instead of throwing. */
export async function requireAdminPage(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) redirect("/login");
  return ctx;
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
