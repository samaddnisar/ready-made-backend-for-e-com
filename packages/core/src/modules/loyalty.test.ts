import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { customers, loyaltyAccounts, loyaltyLedger, orders } from "../db/schema";
import {
  adminAdjustLoyalty,
  adminGetLoyaltyDetail,
  adminListLoyaltyAccounts,
  awardLoyaltyPoints,
  getLoyaltyAccount,
  loyaltyPointsForTotal,
} from "./loyalty";

let db: Db;

const ADMIN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function mkCustomer(email = "jane@example.com") {
  const [row] = await db.insert(customers).values({ email }).returning();
  return row!;
}

async function mkOrder(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-${Math.floor(Math.random() * 1e9)}`,
      email: "jane@example.com",
      subtotal: 12345,
      grandTotal: 12345,
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
  await db.delete(loyaltyLedger);
  await db.delete(loyaltyAccounts);
  await db.delete(orders);
  await db.delete(customers);
});

describe("loyaltyPointsForTotal", () => {
  it("gives 1 point per major unit, floored", () => {
    expect(loyaltyPointsForTotal(12345)).toBe(123);
    expect(loyaltyPointsForTotal(100)).toBe(1);
    expect(loyaltyPointsForTotal(99)).toBe(0);
    expect(loyaltyPointsForTotal(0)).toBe(0);
  });
});

describe("awardLoyaltyPoints", () => {
  it("bootstraps the account on first earn and credits floor(grandTotal/100)", async () => {
    const customer = await mkCustomer();
    const order = await mkOrder({ customerId: customer.id, grandTotal: 12345 });

    const result = await awardLoyaltyPoints(order.id);
    expect(result).toEqual({ awarded: true, points: 123 });

    const account = await db.query.loyaltyAccounts.findFirst({
      where: eq(loyaltyAccounts.customerId, customer.id),
    });
    expect(account?.balance).toBe(123);

    const entries = await db
      .select()
      .from(loyaltyLedger)
      .where(eq(loyaltyLedger.accountId, account!.id));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.delta).toBe(123);
    expect(entries[0]!.orderId).toBe(order.id);
    expect(entries[0]!.reason).toBe(`order:${order.id}`);
  });

  it("is idempotent under a double webhook delivery", async () => {
    const customer = await mkCustomer();
    const order = await mkOrder({ customerId: customer.id, grandTotal: 5000 });

    const first = await awardLoyaltyPoints(order.id);
    const second = await awardLoyaltyPoints(order.id);
    expect(first.awarded).toBe(true);
    expect(second.awarded).toBe(false);

    const account = await db.query.loyaltyAccounts.findFirst({
      where: eq(loyaltyAccounts.customerId, customer.id),
    });
    expect(account?.balance).toBe(50);
    const entries = await db
      .select()
      .from(loyaltyLedger)
      .where(eq(loyaltyLedger.accountId, account!.id));
    expect(entries).toHaveLength(1);
  });

  it("skips guest orders (no customerId) without creating anything", async () => {
    const order = await mkOrder({ customerId: null });
    const result = await awardLoyaltyPoints(order.id);
    expect(result).toEqual({ awarded: false, points: 0 });
    expect(await db.select().from(loyaltyAccounts)).toHaveLength(0);
    expect(await db.select().from(loyaltyLedger)).toHaveLength(0);
  });

  it("skips sub-unit orders that floor to zero points", async () => {
    const customer = await mkCustomer();
    const order = await mkOrder({ customerId: customer.id, grandTotal: 99, subtotal: 99 });
    const result = await awardLoyaltyPoints(order.id);
    expect(result).toEqual({ awarded: false, points: 0 });
    expect(await db.select().from(loyaltyAccounts)).toHaveLength(0);
  });

  it("accumulates across separate orders", async () => {
    const customer = await mkCustomer();
    const a = await mkOrder({ customerId: customer.id, grandTotal: 1000 });
    const b = await mkOrder({ customerId: customer.id, grandTotal: 2550 });
    await awardLoyaltyPoints(a.id);
    await awardLoyaltyPoints(b.id);

    const view = await getLoyaltyAccount(customer.id, { page: 1, pageSize: 10 });
    expect(view.balance).toBe(35); // 10 + 25
    expect(view.ledger.total).toBe(2);
  });

  it("skips soft-deleted customers", async () => {
    const customer = await mkCustomer();
    const order = await mkOrder({ customerId: customer.id });
    await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, customer.id));

    const result = await awardLoyaltyPoints(order.id);
    expect(result.awarded).toBe(false);
    expect(await db.select().from(loyaltyAccounts)).toHaveLength(0);
  });

  it("404s for an unknown order", async () => {
    await expect(
      awardLoyaltyPoints("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
    ).rejects.toThrow(/not found/i);
  });
});

describe("getLoyaltyAccount", () => {
  it("returns a zero balance and empty ledger before any earn", async () => {
    const customer = await mkCustomer();
    const view = await getLoyaltyAccount(customer.id, { page: 1, pageSize: 10 });
    expect(view.balance).toBe(0);
    expect(view.ledger.items).toHaveLength(0);
    expect(view.ledger.total).toBe(0);
  });

  it("paginates the ledger", async () => {
    const customer = await mkCustomer();
    for (let i = 0; i < 3; i++) {
      const order = await mkOrder({ customerId: customer.id, grandTotal: 1000 });
      await awardLoyaltyPoints(order.id);
    }
    const page1 = await getLoyaltyAccount(customer.id, { page: 1, pageSize: 2 });
    expect(page1.ledger.items).toHaveLength(2);
    expect(page1.ledger.total).toBe(3);
    expect(page1.ledger.totalPages).toBe(2);
    const page2 = await getLoyaltyAccount(customer.id, { page: 2, pageSize: 2 });
    expect(page2.ledger.items).toHaveLength(1);
  });
});

describe("adminAdjustLoyalty", () => {
  it("bootstraps the account and credits a positive adjustment", async () => {
    const customer = await mkCustomer();
    const result = await adminAdjustLoyalty(customer.id, 50, "Goodwill credit", ADMIN_ID);
    expect(result.balance).toBe(50);
    expect(result.entry.delta).toBe(50);
    expect(result.entry.reason).toBe("Goodwill credit");

    const view = await getLoyaltyAccount(customer.id, { page: 1, pageSize: 10 });
    expect(view.balance).toBe(50);
    expect(view.ledger.items).toHaveLength(1);
  });

  it("never lets the balance go below zero", async () => {
    const customer = await mkCustomer();
    await adminAdjustLoyalty(customer.id, 30, "Seed", ADMIN_ID);

    await expect(adminAdjustLoyalty(customer.id, -31, "Too much", ADMIN_ID)).rejects.toThrow(
      /negative/i,
    );
    // Balance untouched, no ledger row for the failed attempt.
    const view = await getLoyaltyAccount(customer.id, { page: 1, pageSize: 10 });
    expect(view.balance).toBe(30);
    expect(view.ledger.total).toBe(1);

    // Down to exactly zero is allowed.
    const zeroed = await adminAdjustLoyalty(customer.id, -30, "Expire points", ADMIN_ID);
    expect(zeroed.balance).toBe(0);
  });

  it("rejects zero deltas and blank reasons", async () => {
    const customer = await mkCustomer();
    await expect(adminAdjustLoyalty(customer.id, 0, "Nothing", ADMIN_ID)).rejects.toThrow(
      /non-zero/i,
    );
    await expect(adminAdjustLoyalty(customer.id, 10, "   ", ADMIN_ID)).rejects.toThrow(
      /reason/i,
    );
  });

  it("404s for unknown or soft-deleted customers", async () => {
    await expect(
      adminAdjustLoyalty("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", 10, "x", ADMIN_ID),
    ).rejects.toThrow(/not found/i);

    const customer = await mkCustomer();
    await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, customer.id));
    await expect(adminAdjustLoyalty(customer.id, 10, "x", ADMIN_ID)).rejects.toThrow(/not found/i);
  });
});

describe("adminListLoyaltyAccounts / adminGetLoyaltyDetail", () => {
  it("lists accounts with customer identity and filters by email", async () => {
    const jane = await mkCustomer("jane@example.com");
    const bob = await mkCustomer("bob@example.com");
    const orderJane = await mkOrder({ customerId: jane.id, grandTotal: 2000 });
    const orderBob = await mkOrder({ customerId: bob.id, grandTotal: 3000, email: "bob@example.com" });
    await awardLoyaltyPoints(orderJane.id);
    await awardLoyaltyPoints(orderBob.id);

    const all = await adminListLoyaltyAccounts({ page: 1, pageSize: 10 });
    expect(all.total).toBe(2);

    const filtered = await adminListLoyaltyAccounts({ page: 1, pageSize: 10, q: "jane" });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]!.email).toBe("jane@example.com");
    expect(filtered.items[0]!.balance).toBe(20);
    expect(filtered.items[0]!.customerId).toBe(jane.id);
  });

  it("hides accounts of soft-deleted customers", async () => {
    const jane = await mkCustomer();
    const order = await mkOrder({ customerId: jane.id, grandTotal: 2000 });
    await awardLoyaltyPoints(order.id);
    await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, jane.id));

    const all = await adminListLoyaltyAccounts({ page: 1, pageSize: 10 });
    expect(all.total).toBe(0);
  });

  it("detail returns customer + balance + ledger", async () => {
    const jane = await mkCustomer();
    const order = await mkOrder({ customerId: jane.id, grandTotal: 4200 });
    await awardLoyaltyPoints(order.id);

    const detail = await adminGetLoyaltyDetail(jane.id, { page: 1, pageSize: 10 });
    expect(detail.customer.email).toBe("jane@example.com");
    expect(detail.balance).toBe(42);
    expect(detail.ledger.items[0]!.orderId).toBe(order.id);
  });
});
