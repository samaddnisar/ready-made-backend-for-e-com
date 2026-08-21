import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { inventory, inventoryReservations, orders, products, productVariants } from "../db/schema";
import { AppError } from "../errors";
import {
  adjustStock,
  consumeCartReservations,
  getAvailability,
  releaseCartReservations,
  releaseExpiredReservations,
  reserveStock,
} from "./service";
import { carts } from "../db/schema";

let db: Db;
let variantId: string;
let cartA: string;
let cartB: string;

async function seed() {
  const [product] = await db
    .insert(products)
    .values({ title: "Test Shirt", slug: "test-shirt", status: "active" })
    .returning();
  const [variant] = await db
    .insert(productVariants)
    .values({ productId: product!.id, price: 1999, sku: "SHIRT-1" })
    .returning();
  variantId = variant!.id;
  await db.insert(inventory).values({ variantId, quantity: 5, trackInventory: true });

  const mkCart = async (token: string) => {
    const [cart] = await db
      .insert(carts)
      .values({
        sessionToken: token,
        currency: "USD",
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();
    return cart!.id;
  };
  cartA = await mkCart("cart-a");
  cartB = await mkCart("cart-b");
}

async function getInv() {
  const [row] = await db.select().from(inventory).where(eq(inventory.variantId, variantId));
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(inventoryReservations);
  await db.delete(inventory);
  await db.delete(orders);
  await db.delete(carts);
  await db.delete(productVariants);
  await db.delete(products);
  await seed();
});

describe("adjustStock", () => {
  it("applies positive and negative deltas and records the reason", async () => {
    const r1 = await adjustStock({ variantId, delta: 10, reason: "Received shipment" }, "11111111-1111-4111-8111-111111111111");
    expect(r1.quantity).toBe(15);
    const r2 = await adjustStock({ variantId, delta: -3, reason: "Damaged" }, "11111111-1111-4111-8111-111111111111");
    expect(r2.quantity).toBe(12);
  });

  it("refuses to make stock negative", async () => {
    await expect(
      adjustStock({ variantId, delta: -6, reason: "Oops" }, "11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow(/negative/);
    expect((await getInv()).quantity).toBe(5);
  });
});

describe("reserveStock", () => {
  it("holds stock and reduces availability", async () => {
    await reserveStock(cartA, [{ variantId, quantity: 3 }]);
    const inv = await getInv();
    expect(inv.quantity).toBe(5);
    expect(inv.reservedQty).toBe(3);

    const availability = await getAvailability([variantId]);
    expect(availability.get(variantId)!.available).toBe(2);
  });

  it("rejects when two carts race for the last units", async () => {
    await reserveStock(cartA, [{ variantId, quantity: 4 }]);
    // Cart B wants 2 but only 1 is left.
    await expect(reserveStock(cartB, [{ variantId, quantity: 2 }])).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === "out_of_stock",
    );
    // Failed attempt rolled back completely — reserved is still cart A's 4.
    expect((await getInv()).reservedQty).toBe(4);
  });

  it("rolls back partial holds when any item is short", async () => {
    const [p2] = await db
      .insert(products)
      .values({ title: "Hat", slug: "hat", status: "active" })
      .returning();
    const [v2] = await db
      .insert(productVariants)
      .values({ productId: p2!.id, price: 999 })
      .returning();
    await db.insert(inventory).values({ variantId: v2!.id, quantity: 0, trackInventory: true });

    await expect(
      reserveStock(cartA, [
        { variantId, quantity: 1 },
        { variantId: v2!.id, quantity: 1 },
      ]),
    ).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.code === "out_of_stock");

    // The shirt hold must not survive the failed multi-item reservation.
    expect((await getInv()).reservedQty).toBe(0);
  });

  it("re-reserving for the same cart replaces the old hold instead of stacking", async () => {
    await reserveStock(cartA, [{ variantId, quantity: 2 }]);
    await reserveStock(cartA, [{ variantId, quantity: 3 }]);
    expect((await getInv()).reservedQty).toBe(3);
  });

  it("allows overselling only with allowBackorder", async () => {
    await db.update(inventory).set({ allowBackorder: true }).where(eq(inventory.variantId, variantId));
    await reserveStock(cartA, [{ variantId, quantity: 10 }]);
    expect((await getInv()).reservedQty).toBe(10);
  });

  it("ignores untracked variants", async () => {
    await db.update(inventory).set({ trackInventory: false }).where(eq(inventory.variantId, variantId));
    await reserveStock(cartA, [{ variantId, quantity: 100 }]);
    expect((await getInv()).reservedQty).toBe(0);
  });
});

describe("release / consume / expire", () => {
  it("release returns held stock", async () => {
    await reserveStock(cartA, [{ variantId, quantity: 3 }]);
    await releaseCartReservations(cartA);
    const inv = await getInv();
    expect(inv.quantity).toBe(5);
    expect(inv.reservedQty).toBe(0);
  });

  it("consume decrements on-hand stock exactly once", async () => {
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: "ORD-1001",
        email: "buyer@example.com",
        subtotal: 5997,
        grandTotal: 5997,
        currency: "USD",
      })
      .returning();

    await reserveStock(cartA, [{ variantId, quantity: 3 }]);
    await consumeCartReservations(cartA, order!.id);
    let inv = await getInv();
    expect(inv.quantity).toBe(2);
    expect(inv.reservedQty).toBe(0);

    // Idempotent: consuming again (duplicate webhook) does nothing.
    await consumeCartReservations(cartA, order!.id);
    inv = await getInv();
    expect(inv.quantity).toBe(2);
    expect(inv.reservedQty).toBe(0);
  });

  it("expired holds are swept back into availability", async () => {
    await reserveStock(cartA, [{ variantId, quantity: 3 }], 30);
    // Force-expire the hold.
    await db
      .update(inventoryReservations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(inventoryReservations.cartId, cartA));

    const released = await releaseExpiredReservations();
    expect(released).toBe(1);
    expect((await getInv()).reservedQty).toBe(0);

    // Sweep again: nothing left to release.
    expect(await releaseExpiredReservations()).toBe(0);
  });
});

describe("getAvailability", () => {
  it("reports untracked variants as always in stock", async () => {
    await db.update(inventory).set({ trackInventory: false }).where(eq(inventory.variantId, variantId));
    const availability = await getAvailability([variantId]);
    expect(availability.get(variantId)!.inStock).toBe(true);
  });

  it("reports out-of-stock tracked variants", async () => {
    await db.update(inventory).set({ quantity: 0 }).where(eq(inventory.variantId, variantId));
    const availability = await getAvailability([variantId]);
    expect(availability.get(variantId)!.inStock).toBe(false);
  });
});
