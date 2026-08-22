import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { adminUsers, auditLog, roles } from "../db/schema";
import { SYSTEM_ROLES } from "../rbac/index";
import {
  addAdminUser,
  createRole,
  deleteRole,
  listAdminUsers,
  listAuditLog,
  listRoles,
  removeAdmin,
  updateAdminRole,
  updateRole,
} from "./admins";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  // Seed the built-in roles the same way db/seed.ts does.
  for (const role of SYSTEM_ROLES) {
    await db
      .insert(roles)
      .values({ name: role.name, permissions: role.permissions, isSystem: true })
      .onConflictDoNothing();
  }
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(adminUsers);
  await db.delete(roles).where(eq(roles.isSystem, false));
});

async function roleIdByName(name: string): Promise<string> {
  const row = await db.query.roles.findFirst({ where: eq(roles.name, name) });
  if (!row) throw new Error(`missing role ${name}`);
  return row.id;
}

async function mkAdmin(email: string, roleName: string) {
  return addAdminUser({ email, authUserId: randomUUID(), roleId: await roleIdByName(roleName) });
}

describe("role CRUD guards", () => {
  it("creates a custom role and lists it with member counts", async () => {
    const created = await createRole({ name: "support", permissions: { orders: ["read"] } });
    expect(created.isSystem).toBe(false);

    await mkAdmin("sue@example.com", "support");

    const list = await listRoles();
    const support = list.find((r) => r.name === "support")!;
    expect(support.memberCount).toBe(1);
    // System roles are present and sorted first.
    expect(list.slice(0, SYSTEM_ROLES.length).every((r) => r.isSystem)).toBe(true);
  });

  it("system roles can't be edited", async () => {
    const superAdminId = await roleIdByName("super_admin");
    await expect(updateRole(superAdminId, { name: "renamed" })).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
  });

  it("system roles can't be deleted", async () => {
    const viewerId = await roleIdByName("viewer");
    await expect(deleteRole(viewerId)).rejects.toMatchObject({ code: "conflict", status: 409 });
  });

  it("a role with members can't be deleted until they're reassigned", async () => {
    const role = await createRole({ name: "support", permissions: { orders: ["read"] } });
    const admin = await mkAdmin("sue@example.com", "support");

    await expect(deleteRole(role.id)).rejects.toMatchObject({ code: "conflict", status: 409 });

    await updateAdminRole(admin.id, await roleIdByName("viewer"));
    await deleteRole(role.id);
    expect(await db.query.roles.findFirst({ where: eq(roles.id, role.id) })).toBeUndefined();
  });

  it("updates an unused custom role and 404s on unknown ids", async () => {
    const role = await createRole({ name: "support", permissions: { orders: ["read"] } });
    const updated = await updateRole(role.id, {
      name: "helpdesk",
      permissions: { orders: ["read", "update"] },
    });
    expect(updated.name).toBe("helpdesk");
    expect(updated.permissions).toEqual({ orders: ["read", "update"] });

    await expect(updateRole(randomUUID(), { name: "nope" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(deleteRole(randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("addAdminUser", () => {
  it("stores the email lowercased and joins the role name", async () => {
    const row = await addAdminUser({
      email: "Jane@Example.com",
      authUserId: randomUUID(),
      roleId: await roleIdByName("manager"),
    });
    expect(row.email).toBe("jane@example.com");
    expect(row.roleName).toBe("manager");

    const list = await listAdminUsers();
    expect(list).toHaveLength(1);
    expect(list[0]!.roleName).toBe("manager");
  });

  it("409s when the user is already an admin", async () => {
    const first = await mkAdmin("jane@example.com", "viewer");
    await expect(
      addAdminUser({
        email: first.email,
        authUserId: randomUUID(),
        roleId: await roleIdByName("viewer"),
      }),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
  });

  it("404s on an unknown role", async () => {
    await expect(
      addAdminUser({ email: "jane@example.com", authUserId: randomUUID(), roleId: randomUUID() }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("updateAdminRole", () => {
  it("refuses to demote the only super_admin", async () => {
    const only = await mkAdmin("boss@example.com", "super_admin");
    await expect(updateAdminRole(only.id, await roleIdByName("viewer"))).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
  });

  it("demotes a super_admin when another one exists", async () => {
    const a = await mkAdmin("a@example.com", "super_admin");
    await mkAdmin("b@example.com", "super_admin");

    await updateAdminRole(a.id, await roleIdByName("viewer"));
    const row = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, a.id),
      with: { role: true },
    });
    expect(row!.role.name).toBe("viewer");
  });

  it("moving a super_admin to another super_admin-named grant is fine, and 404s on unknowns", async () => {
    const a = await mkAdmin("a@example.com", "super_admin");
    // Same role again is not a demotion.
    await updateAdminRole(a.id, await roleIdByName("super_admin"));

    await expect(updateAdminRole(randomUUID(), await roleIdByName("viewer"))).rejects.toMatchObject(
      { code: "not_found" },
    );
    await expect(updateAdminRole(a.id, randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("removeAdmin", () => {
  it("blocks removing yourself", async () => {
    const self = await mkAdmin("me@example.com", "super_admin");
    await expect(removeAdmin(self.id, self.id)).rejects.toMatchObject({
      code: "bad_request",
      status: 400,
    });
  });

  it("blocks removing the last super_admin", async () => {
    const boss = await mkAdmin("boss@example.com", "super_admin");
    const other = await mkAdmin("viewer@example.com", "viewer");
    await expect(removeAdmin(boss.id, other.id)).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
  });

  it("removes a super_admin when another one exists", async () => {
    const a = await mkAdmin("a@example.com", "super_admin");
    const b = await mkAdmin("b@example.com", "super_admin");

    await removeAdmin(a.id, b.id);
    expect(
      await db.query.adminUsers.findFirst({ where: eq(adminUsers.id, a.id) }),
    ).toBeUndefined();
  });
});

describe("listAuditLog", () => {
  const BASE = { page: 1, pageSize: 20 };

  async function seedEntries() {
    const alice = await mkAdmin("alice@store.com", "super_admin");
    const bob = await mkAdmin("bob@shop.com", "manager");
    await db.insert(auditLog).values([
      {
        adminUserId: alice.id,
        action: "create",
        resource: "product",
        resourceId: "prod-123",
        diff: { after: { title: "Widget" } },
        createdAt: new Date("2026-01-01T12:00:00Z"),
      },
      {
        adminUserId: bob.id,
        action: "refund",
        resource: "order",
        resourceId: "ord-999",
        createdAt: new Date("2026-02-01T12:00:00Z"),
      },
      {
        adminUserId: null,
        action: "delete",
        resource: "product",
        resourceId: "prod-456",
        createdAt: new Date("2026-03-01T12:00:00Z"),
      },
    ]);
    return { alice, bob };
  }

  it("returns newest first with the admin email resolved (null → system entry)", async () => {
    await seedEntries();
    const result = await listAuditLog({ ...BASE });
    expect(result.total).toBe(3);
    expect(result.items.map((r) => r.resourceId)).toEqual(["prod-456", "ord-999", "prod-123"]);
    expect(result.items[0]!.adminEmail).toBeNull();
    expect(result.items[2]!.adminEmail).toBe("alice@store.com");
  });

  it("filters by resource", async () => {
    await seedEntries();
    const result = await listAuditLog({ ...BASE, resource: "product" });
    expect(result.total).toBe(2);
    expect(result.items.every((r) => r.resource === "product")).toBe(true);
  });

  it("q matches the admin email", async () => {
    await seedEntries();
    const result = await listAuditLog({ ...BASE, q: "alice" });
    expect(result.total).toBe(1);
    expect(result.items[0]!.resourceId).toBe("prod-123");

    const byDomain = await listAuditLog({ ...BASE, q: "shop.com" });
    expect(byDomain.total).toBe(1);
    expect(byDomain.items[0]!.adminEmail).toBe("bob@shop.com");
  });

  it("q matches the resource id", async () => {
    await seedEntries();
    const result = await listAuditLog({ ...BASE, q: "ord-999" });
    expect(result.total).toBe(1);
    expect(result.items[0]!.action).toBe("refund");
  });

  it("filters by date range", async () => {
    await seedEntries();
    const windowed = await listAuditLog({
      ...BASE,
      from: "2026-01-15T00:00:00.000Z",
      to: "2026-02-15T00:00:00.000Z",
    });
    expect(windowed.total).toBe(1);
    expect(windowed.items[0]!.resourceId).toBe("ord-999");

    const fromOnly = await listAuditLog({ ...BASE, from: "2026-01-15T00:00:00.000Z" });
    expect(fromOnly.total).toBe(2);

    const toOnly = await listAuditLog({ ...BASE, to: "2026-01-15T00:00:00.000Z" });
    expect(toOnly.total).toBe(1);
    expect(toOnly.items[0]!.resourceId).toBe("prod-123");
  });

  it("combines filters and paginates", async () => {
    await seedEntries();
    const combined = await listAuditLog({
      ...BASE,
      resource: "product",
      q: "prod-4",
    });
    expect(combined.total).toBe(1);
    expect(combined.items[0]!.resourceId).toBe("prod-456");

    const paged = await listAuditLog({ page: 2, pageSize: 2 });
    expect(paged.total).toBe(3);
    expect(paged.totalPages).toBe(2);
    expect(paged.items).toHaveLength(1);
    expect(paged.items[0]!.resourceId).toBe("prod-123");
  });
});
