import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { orders, orderStatusHistory } from "../db/schema";
import { canTransition, transitionOrder } from "./state-machine";

let db: Db;
let orderId: string;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(orderStatusHistory);
  await db.delete(orders);
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: "ORD-9001",
      email: "t@example.com",
      subtotal: 1000,
      grandTotal: 1000,
      currency: "USD",
    })
    .returning();
  orderId = order!.id;
});

describe("canTransition", () => {
  it("encodes the §6 diagram", () => {
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("pending", "shipped")).toBe(false);
    expect(canTransition("paid", "fulfilled")).toBe(true);
    expect(canTransition("paid", "pending")).toBe(false);
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("delivered", "completed")).toBe(true);
    expect(canTransition("completed", "refunded")).toBe(true);
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("cancelled", "paid")).toBe(false);
    expect(canTransition("payment_failed", "pending")).toBe(true);
  });
});

describe("transitionOrder", () => {
  it("applies a legal transition and records history", async () => {
    const result = await transitionOrder(orderId, "paid", "webhook:stripe");
    expect(result.order.status).toBe("paid");
    expect(result.fromStatus).toBe("pending");

    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId));
    expect(history).toHaveLength(1);
    expect(history[0]!.fromStatus).toBe("pending");
    expect(history[0]!.toStatus).toBe("paid");
    expect(history[0]!.actor).toBe("webhook:stripe");
  });

  it("rejects an illegal transition", async () => {
    await expect(transitionOrder(orderId, "shipped", "system")).rejects.toThrow(/Can't move order/);
  });

  it("is idempotent for the same target status (no history spam)", async () => {
    await transitionOrder(orderId, "paid", "webhook:stripe");
    const again = await transitionOrder(orderId, "paid", "webhook:stripe");
    expect(again.fromStatus).toBe("paid");

    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId));
    expect(history).toHaveLength(1);
  });

  it("walks the full happy path", async () => {
    for (const status of ["paid", "fulfilled", "shipped", "delivered", "completed"] as const) {
      await transitionOrder(orderId, status, "system");
    }
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe("completed");
    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId));
    expect(history).toHaveLength(5);
  });
});
