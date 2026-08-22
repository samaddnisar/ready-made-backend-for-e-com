import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { addresses, customers, orders } from "../db/schema";
import {
  createAddress,
  deleteAddress,
  getCustomerOrder,
  getOrCreateCustomerByAuth,
  listCustomers,
  updateAddress,
} from "./service";

let db: Db;

const AUTH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function mkOrder(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-${Math.floor(Math.random() * 1e9)}`,
      email: "jane@example.com",
      subtotal: 1000,
      grandTotal: 1000,
      currency: "USD",
      status: "paid",
      ...overrides,
    })
    .returning();
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(orders);
  await db.delete(addresses);
  await db.delete(customers);
});

describe("getOrCreateCustomerByAuth", () => {
  it("creates on first login and returns the same row after", async () => {
    const first = await getOrCreateCustomerByAuth(AUTH_A, "Jane@Example.com");
    expect(first.email).toBe("jane@example.com");
    const again = await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");
    expect(again.id).toBe(first.id);
  });

  it("links an existing guest-checkout customer row by email", async () => {
    const [guest] = await db.insert(customers).values({ email: "jane@example.com" }).returning();
    const linked = await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");
    expect(linked.id).toBe(guest!.id);
    expect(linked.authUserId).toBe(AUTH_A);
  });

  it("refuses to steal an email already linked to another auth user", async () => {
    await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");
    await expect(getOrCreateCustomerByAuth(AUTH_B, "jane@example.com")).rejects.toThrow(
      /another account/,
    );
  });

  it("claims past guest orders with the same email", async () => {
    const guestOrder = await mkOrder({ customerId: null });
    const customer = await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");

    const [claimed] = await db.select().from(orders).where(eq(orders.id, guestOrder.id));
    expect(claimed!.customerId).toBe(customer.id);
  });
});

describe("lifetime value", () => {
  it("counts kept paid orders, excludes refunded/cancelled/pending", async () => {
    const customer = await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");
    await mkOrder({ customerId: customer.id, status: "paid", grandTotal: 1000 });
    await mkOrder({ customerId: customer.id, status: "completed", grandTotal: 2000 });
    await mkOrder({ customerId: customer.id, status: "partially_refunded", grandTotal: 3000 });
    await mkOrder({ customerId: customer.id, status: "refunded", grandTotal: 4000 });
    await mkOrder({ customerId: customer.id, status: "cancelled", grandTotal: 5000 });
    await mkOrder({ customerId: customer.id, status: "pending", grandTotal: 6000 });

    const list = await listCustomers({ page: 1, pageSize: 10, sort: "createdAt", order: "desc" });
    const row = list.items.find((c) => c.id === customer.id)!;
    expect(row.lifetimeValue).toBe(6000); // 1000 + 2000 + 3000
    expect(row.orderCount).toBe(3);
  });
});

describe("customer order scoping", () => {
  it("never returns another customer's order and strips internal notes", async () => {
    const a = await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");
    const b = await getOrCreateCustomerByAuth(AUTH_B, "bob@example.com");
    const order = await mkOrder({ customerId: a.id, notes: "internal: VIP" });

    const mine = await getCustomerOrder(a.id, order.id);
    expect(mine.orderNumber).toBe(order.orderNumber);
    expect("notes" in mine).toBe(false);

    await expect(getCustomerOrder(b.id, order.id)).rejects.toThrow(/not found/i);
  });
});

describe("addresses", () => {
  it("making an address default demotes the previous default of that type", async () => {
    const customer = await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");
    const base = {
      line1: "1 St",
      city: "Town",
      postalCode: "111",
      country: "US" as string,
      type: "shipping" as const,
    };
    const first = await createAddress(customer.id, { ...base, isDefault: true });
    const second = await createAddress(customer.id, { ...base, line1: "2 St", isDefault: true });

    const rows = await db.select().from(addresses).where(eq(addresses.customerId, customer.id));
    expect(rows.find((a) => a.id === first.id)!.isDefault).toBe(false);
    expect(rows.find((a) => a.id === second.id)!.isDefault).toBe(true);

    // Billing defaults are independent of shipping defaults.
    const billing = await createAddress(customer.id, {
      ...base,
      type: "billing",
      isDefault: true,
    });
    const after = await db.select().from(addresses).where(eq(addresses.customerId, customer.id));
    expect(after.find((a) => a.id === second.id)!.isDefault).toBe(true);
    expect(after.find((a) => a.id === billing.id)!.isDefault).toBe(true);
  });

  it("update and delete are scoped to the owner", async () => {
    const a = await getOrCreateCustomerByAuth(AUTH_A, "jane@example.com");
    const b = await getOrCreateCustomerByAuth(AUTH_B, "bob@example.com");
    const address = await createAddress(a.id, {
      type: "shipping",
      line1: "1 St",
      city: "Town",
      postalCode: "111",
      country: "US",
      isDefault: false,
    });

    await expect(updateAddress(b.id, address.id, { line1: "hacked" })).rejects.toThrow(/not found/i);
    await expect(deleteAddress(b.id, address.id)).rejects.toThrow(/not found/i);

    await deleteAddress(a.id, address.id);
    const [row] = await db.select().from(addresses).where(eq(addresses.id, address.id));
    expect(row!.deletedAt).not.toBeNull();
  });
});
