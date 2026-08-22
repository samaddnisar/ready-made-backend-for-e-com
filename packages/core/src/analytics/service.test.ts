import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { inventory, orderItems, orders, products, productVariants } from "../db/schema";
import { getDashboardStats } from "./service";

let db: Db;

const DAY = 86_400_000;
const NOW = new Date("2026-08-20T12:00:00Z");

async function mkOrder(daysAgo: number, grandTotal: number, status = "paid" as const) {
  const [row] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-${Math.floor(Math.random() * 1e9)}`,
      email: "x@x.com",
      subtotal: grandTotal,
      grandTotal,
      currency: "USD",
      status,
      createdAt: new Date(NOW.getTime() - daysAgo * DAY),
    })
    .returning();
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(inventory);
  await db.delete(productVariants);
  await db.delete(products);
});

describe("getDashboardStats", () => {
  it("computes revenue, order count and AOV within the range only", async () => {
    await mkOrder(1, 1000);
    await mkOrder(2, 3000);
    await mkOrder(40, 99_999); // outside window
    await mkOrder(1, 5000, "cancelled" as never); // never revenue
    await mkOrder(1, 7000, "pending" as never); // not yet revenue

    const stats = await getDashboardStats({
      from: new Date(NOW.getTime() - 30 * DAY),
      to: NOW,
    });
    expect(stats.revenue).toBe(4000);
    expect(stats.orderCount).toBe(2);
    expect(stats.aov).toBe(2000);
  });

  it("compares against the immediately preceding window", async () => {
    await mkOrder(5, 2000); // current window (30d)
    await mkOrder(35, 1000); // previous window (30-60d ago)

    const stats = await getDashboardStats({
      from: new Date(NOW.getTime() - 30 * DAY),
      to: NOW,
    });
    expect(stats.revenue).toBe(2000);
    expect(stats.previous.revenue).toBe(1000);
    expect(stats.previous.orderCount).toBe(1);
  });

  it("groups revenue by day and ranks top products by revenue", async () => {
    const o1 = await mkOrder(1, 5000);
    const o2 = await mkOrder(1, 2000);
    await db.insert(orderItems).values([
      { orderId: o1.id, productTitle: "Widget", unitPrice: 2500, quantity: 2 },
      { orderId: o2.id, productTitle: "Gadget", unitPrice: 2000, quantity: 1 },
    ]);

    const stats = await getDashboardStats({
      from: new Date(NOW.getTime() - 30 * DAY),
      to: NOW,
    });
    expect(stats.revenueByDay).toHaveLength(1);
    expect(stats.revenueByDay[0]!.revenue).toBe(7000);
    expect(stats.revenueByDay[0]!.orders).toBe(2);

    expect(stats.topProducts[0]!.productTitle).toBe("Widget");
    expect(stats.topProducts[0]!.revenue).toBe(5000);
    expect(stats.topProducts[0]!.unitsSold).toBe(2);
    expect(stats.topProducts[1]!.productTitle).toBe("Gadget");
  });

  it("reports low-stock counts", async () => {
    const [p] = await db
      .insert(products)
      .values({ title: "P", slug: "p", status: "active" })
      .returning();
    const [v] = await db
      .insert(productVariants)
      .values({ productId: p!.id, price: 100 })
      .returning();
    await db
      .insert(inventory)
      .values({ variantId: v!.id, quantity: 0, trackInventory: true, lowStockThreshold: 5 });

    const stats = await getDashboardStats({ from: new Date(NOW.getTime() - DAY), to: NOW });
    expect(stats.lowStock.low).toBe(1);
    expect(stats.lowStock.out).toBe(1);
  });
});
