import { and, asc, desc, eq, ilike, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { adminUsers, auditLog, roles } from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { ACTIONS, RESOURCES, type RolePermissions } from "../rbac/index";
import { emailSchema, paginate, paginationQuerySchema, uuidSchema, type Paginated } from "../validation/common";

// ── Validation ───────────────────────────────────────────────

const permissionActionSchema = z.enum([...ACTIONS, "*"] as [string, ...string[]]);
// partialRecord: enum-keyed z.record is EXHAUSTIVE in zod 4 — sparse maps
// like the seeded {"*": ["*"]} must stay valid.
export const rolePermissionsSchema = z.partialRecord(
  z.enum([...RESOURCES, "*"] as [string, ...string[]]),
  z.array(permissionActionSchema).max(ACTIONS.length + 1),
);

export const createRoleSchema = z
  .object({
    name: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers and underscores"),
    permissions: rolePermissionsSchema,
  })
  .strict();

export const updateRoleSchema = z
  .object({
    name: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    permissions: rolePermissionsSchema.optional(),
  })
  .strict();

export const inviteAdminSchema = z
  .object({ email: emailSchema, roleId: uuidSchema, name: z.string().max(200).optional() })
  .strict();

export const updateAdminSchema = z.object({ roleId: uuidSchema }).strict();

export const listAuditLogQuerySchema = paginationQuerySchema.extend({
  resource: z.string().max(50).optional(),
  q: z.string().max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;

// ── Roles ────────────────────────────────────────────────────

export type RoleWithCount = typeof roles.$inferSelect & { memberCount: number };

export async function listRoles(): Promise<RoleWithCount[]> {
  const db = getDb();
  return db
    .select({
      id: roles.id,
      name: roles.name,
      permissions: roles.permissions,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
      memberCount: sql<number>`(select count(*)::int from admin_users au where au.role_id = roles.id)`,
    })
    .from(roles)
    .orderBy(desc(roles.isSystem), asc(roles.name));
}

export async function createRole(input: CreateRoleInput) {
  const db = getDb();
  const [row] = await db
    .insert(roles)
    .values({ name: input.name, permissions: input.permissions as RolePermissions, isSystem: false })
    .returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateRole(id: string, input: UpdateRoleInput) {
  const db = getDb();
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) throw notFound("Role not found");
  if (existing.isSystem) throw conflict("Built-in roles can't be edited");

  const [row] = await db
    .update(roles)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.permissions !== undefined
        ? { permissions: input.permissions as RolePermissions }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(roles.id, id))
    .returning();
  return row!;
}

export async function deleteRole(id: string): Promise<void> {
  const db = getDb();
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) throw notFound("Role not found");
  if (existing.isSystem) throw conflict("Built-in roles can't be deleted");
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminUsers)
    .where(eq(adminUsers.roleId, id));
  if ((count?.n ?? 0) > 0) throw conflict("Reassign this role's members first");
  await db.delete(roles).where(eq(roles.id, id));
}

// ── Admin users ──────────────────────────────────────────────

export type AdminUserRow = typeof adminUsers.$inferSelect & { roleName: string };

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: adminUsers.id,
      authUserId: adminUsers.authUserId,
      email: adminUsers.email,
      name: adminUsers.name,
      roleId: adminUsers.roleId,
      lastLoginAt: adminUsers.lastLoginAt,
      createdAt: adminUsers.createdAt,
      updatedAt: adminUsers.updatedAt,
      roleName: roles.name,
    })
    .from(adminUsers)
    .innerJoin(roles, eq(roles.id, adminUsers.roleId))
    .orderBy(asc(adminUsers.email));
  return rows;
}

/** The route resolves/creates the Supabase auth user, then records it here. */
export async function addAdminUser(input: {
  email: string;
  authUserId: string;
  roleId: string;
  name?: string;
}): Promise<AdminUserRow> {
  const db = getDb();
  const role = await db.query.roles.findFirst({ where: eq(roles.id, input.roleId) });
  if (!role) throw notFound("Role not found");

  const [row] = await db
    .insert(adminUsers)
    .values({
      email: input.email.toLowerCase(),
      authUserId: input.authUserId,
      roleId: input.roleId,
      name: input.name ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw conflict("This user is already an admin");
  return { ...row, roleName: role.name };
}

async function superAdminCount(excludeAdminId?: string): Promise<number> {
  const db = getDb();
  const filters: SQL[] = [eq(roles.name, "super_admin")];
  if (excludeAdminId) filters.push(ne(adminUsers.id, excludeAdminId));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminUsers)
    .innerJoin(roles, eq(roles.id, adminUsers.roleId))
    .where(and(...filters));
  return row?.n ?? 0;
}

export async function updateAdminRole(id: string, roleId: string): Promise<void> {
  const db = getDb();
  const target = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, id),
    with: { role: true },
  });
  if (!target) throw notFound("Admin not found");
  const newRole = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
  if (!newRole) throw notFound("Role not found");

  // Never demote the last super_admin — the store would be unmanageable.
  if (target.role.name === "super_admin" && newRole.name !== "super_admin") {
    if ((await superAdminCount(id)) === 0) {
      throw conflict("At least one super admin is required");
    }
  }

  await db
    .update(adminUsers)
    .set({ roleId, updatedAt: new Date() })
    .where(eq(adminUsers.id, id));
}

export async function removeAdmin(id: string, actingAdminId: string): Promise<void> {
  if (id === actingAdminId) throw badRequest("You can't remove your own admin access");
  const db = getDb();
  const target = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, id),
    with: { role: true },
  });
  if (!target) throw notFound("Admin not found");
  if (target.role.name === "super_admin" && (await superAdminCount(id)) === 0) {
    throw conflict("At least one super admin is required");
  }
  await db.delete(adminUsers).where(eq(adminUsers.id, id));
}

// ── Audit log ────────────────────────────────────────────────

export type AuditLogRow = typeof auditLog.$inferSelect & {
  adminEmail: string | null;
};

export async function listAuditLog(query: ListAuditLogQuery): Promise<Paginated<AuditLogRow>> {
  const db = getDb();
  const filters: SQL[] = [];
  if (query.resource) filters.push(eq(auditLog.resource, query.resource));
  if (query.q) {
    filters.push(
      sql`(${auditLog.resourceId} ilike ${"%" + query.q + "%"} or exists (select 1 from admin_users au where au.id = ${auditLog.adminUserId} and au.email ilike ${"%" + query.q + "%"}))`,
    );
  }
  if (query.from) filters.push(sql`${auditLog.createdAt} >= ${new Date(query.from)}`);
  if (query.to) filters.push(sql`${auditLog.createdAt} <= ${new Date(query.to)}`);
  const where = filters.length ? and(...filters) : undefined;

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where);
  const rows = await db
    .select({
      id: auditLog.id,
      adminUserId: auditLog.adminUserId,
      action: auditLog.action,
      resource: auditLog.resource,
      resourceId: auditLog.resourceId,
      diff: auditLog.diff,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
      updatedAt: auditLog.updatedAt,
      adminEmail: sql<string | null>`(select au.email from admin_users au where au.id = ${auditLog.adminUserId})`,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}
