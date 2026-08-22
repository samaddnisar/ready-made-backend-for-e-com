import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import {
  abandonedCarts,
  cartItems,
  carts,
  customers,
  orders,
  productVariants,
  products,
} from "../db/schema";
import {
  detectAbandonedCarts,
  getAbandonedCartDetail,
  listAbandoned,
  markRecovered,
  markReminderSent,
} from "./abandoned-carts";

let db: Db;

const HOUR = 3_600_000;
/** Older than the default 6h cutoff. */
const STALE = () => new Date(Date.now() - 7 * HOUR);
/** Newer than the default 6h cutoff. */
const FRESH = () => new Date(Date.now() - 1 * HOUR);

let seq = 0;

async function mkVariant() {
  seq += 1;
  const [product] = await db
    .insert(products)
    .values({ title: `Tee ${seq}`, slug: `tee-${seq}`, status: "active" })
    .returning();
  const [variant] = await db
    .insert(productVariants)
    .values({ productId: product!.id, title: "M / Black", price: 1500 })
    .returning();
  return variant!;
}

async function mkCustomer(email: string, deleted = false) {
  const [row] = await db
    .insert(customers)
    .values({ email, ...(deleted ? { deletedAt: new Date() } : {}) })
    .returning();
  return row!;
}

async function mkCart(opts: {
  customerId?: string | null;
  updatedAt?: Date;
  status?: (typeof carts.$inferSelect)["status"];
  items?: { variantId: string; quantity: number; unitPrice: number }[];
}) {
  seq += 1;
  const [cart] = await db
    .insert(carts)
    .values({
      sessionToken: `tok-${seq}-${Math.floor(Math.random() * 1e9)}`,
      currency: "USD",
      customerId: opts.customerId ?? null,
      status: opts.status ?? "active",
      expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
      ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
    })
    .returning();
  for (const item of opts.items ?? []) {
    await db.insert(cartItems).values({ cartId: cart!.id, ...item });
  }
  return cart!;
}

async function mkOrder(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-${Math.floor(Math.random() * 1e9)}`,
      email: "guest@example.com",
      subtotal: 1000,
      grandTotal: 1000,
      currency: "USD",
      status: "pending",
      ...overrides,
    })
    .returning();
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  // FK-safe order: children before parents.
  await db.delete(abandonedCarts);
  await db.delete(cartItems);
  await db.delete(orders);
  await db.delete(carts);
  await db.delete(customers);
  await db.delete(productVariants);
  await db.delete(products);
});

describe("detectAbandonedCarts", () => {
  it("marks stale active carts with items and a customer email", async () => {
    const variant = await mkVariant();
    const customer = await mkCustomer("jane@example.com");
    const cart = await mkCart({
      customerId: customer.id,
      updatedAt: STALE(),
      items: [{ variantId: variant.id, quantity: 2, unitPrice: 1500 }],
    });

    const result = await detectAbandonedCarts();
    expect(result.detected).toBe(1);

    const [row] = await db.select().from(abandonedCarts).where(eq(abandonedCarts.cartId, cart.id));
    expect(row!.email).toBe("jane@example.com");
    const [after] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(after!.status).toBe("abandoned");
  });

  it("respects the cutoff — recently touched carts are left alone", async () => {
    const variant = await mkVariant();
    const customer = await mkCustomer("jane@example.com");
    const cart = await mkCart({
      customerId: customer.id,
      updatedAt: FRESH(),
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });

    expect((await detectAbandonedCarts()).detected).toBe(0);
    const [after] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(after!.status).toBe("active");

    // A shorter explicit cutoff catches it.
    expect((await detectAbandonedCarts(0.5)).detected).toBe(1);
  });

  it("skips carts with no items", async () => {
    const customer = await mkCustomer("jane@example.com");
    await mkCart({ customerId: customer.id, updatedAt: STALE(), items: [] });
    expect((await detectAbandonedCarts()).detected).toBe(0);
  });

  it("skips carts with no knowable email (guest, no order, or deleted customer)", async () => {
    const variant = await mkVariant();
    // Guest cart, never reached checkout — no email anywhere.
    await mkCart({
      updatedAt: STALE(),
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });
    // Soft-deleted customer's email must not be used.
    const deleted = await mkCustomer("gone@example.com", true);
    await mkCart({
      customerId: deleted.id,
      updatedAt: STALE(),
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });

    expect((await detectAbandonedCarts()).detected).toBe(0);
    expect(await db.select().from(abandonedCarts)).toHaveLength(0);
  });

  it("falls back to the email captured on an order row for the cart", async () => {
    const variant = await mkVariant();
    const cart = await mkCart({
      updatedAt: STALE(),
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });
    await mkOrder({ cartId: cart.id, email: "guest@example.com", status: "payment_failed" });

    expect((await detectAbandonedCarts()).detected).toBe(1);
    const [row] = await db.select().from(abandonedCarts).where(eq(abandonedCarts.cartId, cart.id));
    expect(row!.email).toBe("guest@example.com");
  });

  it("only touches active carts (converted/expired stay untouched)", async () => {
    const variant = await mkVariant();
    const customer = await mkCustomer("jane@example.com");
    await mkCart({
      customerId: customer.id,
      updatedAt: STALE(),
      status: "converted",
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });
    await mkCart({
      customerId: customer.id,
      updatedAt: STALE(),
      status: "expired",
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });
    expect((await detectAbandonedCarts()).detected).toBe(0);
  });

  it("is idempotent — a second run detects nothing new and never duplicates rows", async () => {
    const variant = await mkVariant();
    const customer = await mkCustomer("jane@example.com");
    const cart = await mkCart({
      customerId: customer.id,
      updatedAt: STALE(),
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });

    expect((await detectAbandonedCarts()).detected).toBe(1);
    expect((await detectAbandonedCarts()).detected).toBe(0);

    // Even a pre-existing row for a still-active cart cannot duplicate.
    await db.update(carts).set({ status: "active", updatedAt: STALE() }).where(eq(carts.id, cart.id));
    expect((await detectAbandonedCarts()).detected).toBe(0);
    expect(await db.select().from(abandonedCarts)).toHaveLength(1);
  });
});

describe("listAbandoned / detail", () => {
  it("returns email, item count and cart value via correlated subqueries", async () => {
    const variant = await mkVariant();
    const customer = await mkCustomer("jane@example.com");
    await mkCart({
      customerId: customer.id,
      updatedAt: STALE(),
      items: [
        { variantId: variant.id, quantity: 2, unitPrice: 1500 },
        { variantId: (await mkVariant()).id, quantity: 1, unitPrice: 500 },
      ],
    });
    await detectAbandonedCarts();

    const list = await listAbandoned({ page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
    const row = list.items[0]!;
    expect(row.email).toBe("jane@example.com");
    expect(row.itemCount).toBe(3); // 2 + 1 units
    expect(row.cartValue).toBe(3500); // 2×1500 + 1×500
    expect(row.currency).toBe("USD");
    expect(row.reminderSentAt).toBeNull();
    expect(row.recoveredAt).toBeNull();

    const detail = await getAbandonedCartDetail(row.id);
    expect(detail.items).toHaveLength(2);
    expect(detail.cartValue).toBe(3500);
    expect(detail.items[0]!.lineTotal).toBe(3000);

    await expect(
      getAbandonedCartDetail("00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(/not found/i);
  });
});

describe("markReminderSent", () => {
  it("stamps reminderSentAt and 404s on unknown ids", async () => {
    const variant = await mkVariant();
    const customer = await mkCustomer("jane@example.com");
    await mkCart({
      customerId: customer.id,
      updatedAt: STALE(),
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });
    await detectAbandonedCarts();
    const [row] = await db.select().from(abandonedCarts);

    const updated = await markReminderSent(row!.id);
    expect(updated.reminderSentAt).not.toBeNull();

    await expect(markReminderSent("00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("markRecovered", () => {
  it("stamps recovery once, is idempotent, and no-ops without an abandoned row", async () => {
    const variant = await mkVariant();
    const customer = await mkCustomer("jane@example.com");
    const cart = await mkCart({
      customerId: customer.id,
      updatedAt: STALE(),
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1500 }],
    });
    await detectAbandonedCarts();

    const order = await mkOrder({ cartId: cart.id, customerId: customer.id, status: "paid" });
    await markRecovered(cart.id, order.id);

    const [row] = await db.select().from(abandonedCarts).where(eq(abandonedCarts.cartId, cart.id));
    expect(row!.recoveredAt).not.toBeNull();
    expect(row!.recoveryOrderId).toBe(order.id);

    // Second conversion signal must not overwrite the first recovery.
    const later = await mkOrder({ cartId: cart.id, customerId: customer.id, status: "paid" });
    await markRecovered(cart.id, later.id);
    const [same] = await db.select().from(abandonedCarts).where(eq(abandonedCarts.cartId, cart.id));
    expect(same!.recoveryOrderId).toBe(order.id);
    expect(same!.recoveredAt!.getTime()).toBe(row!.recoveredAt!.getTime());

    // A cart that was never flagged: silently OK.
    const neverFlagged = await mkCart({ customerId: customer.id });
    await expect(markRecovered(neverFlagged.id, order.id)).resolves.toBeUndefined();
  });
});
