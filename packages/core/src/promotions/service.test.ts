import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import {
  categories,
  customers,
  discountCategories,
  discountProducts,
  discountRedemptions,
  discounts,
  orders,
  productCategories,
  products,
} from "../db/schema";
import { recordDiscountRedemptions, resolveDiscounts } from "./service";

let db: Db;
let productA: string;
let productB: string;

const LINES = () => [
  { productId: productA, quantity: 2, unitPrice: 2000 }, // 4000
  { productId: productB, quantity: 1, unitPrice: 1000 }, // 1000
]; // subtotal 5000

async function mkDiscount(overrides: Partial<typeof discounts.$inferInsert> = {}) {
  const [row] = await db
    .insert(discounts)
    .values({ code: "SAVE10", type: "percent", value: 10, ...overrides })
    .returning();
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  for (const t of [
    discountRedemptions,
    discountProducts,
    discountCategories,
    discounts,
    orders,
    productCategories,
    categories,
    products,
    customers,
  ]) {
    await db.delete(t);
  }
  const [a] = await db
    .insert(products)
    .values({ title: "A", slug: "a", status: "active" })
    .returning();
  const [b] = await db
    .insert(products)
    .values({ title: "B", slug: "b", status: "active" })
    .returning();
  productA = a!.id;
  productB = b!.id;
});

describe("resolveDiscounts", () => {
  it("percent discount on the whole cart", async () => {
    await mkDiscount();
    const result = await resolveDiscounts(["save10"], LINES());
    expect(result.discountTotal).toBe(500);
    expect(result.freeShipping).toBe(false);
  });

  it("fixed discount capped at the eligible amount", async () => {
    await mkDiscount({ code: "BIG", type: "fixed", value: 99_999 });
    const result = await resolveDiscounts(["BIG"], LINES());
    expect(result.discountTotal).toBe(5000);
  });

  it("free_shipping sets the flag without a goods discount", async () => {
    await mkDiscount({ code: "FREESHIP", type: "free_shipping", value: 0 });
    const result = await resolveDiscounts(["FREESHIP"], LINES());
    expect(result.discountTotal).toBe(0);
    expect(result.freeShipping).toBe(true);
  });

  it("rejects unknown, inactive, expired and not-yet-active codes", async () => {
    await mkDiscount({ code: "OFF", isActive: false });
    await mkDiscount({ code: "PAST", endsAt: new Date(Date.now() - 1000) });
    await mkDiscount({ code: "SOON", startsAt: new Date(Date.now() + 86_400_000) });

    await expect(resolveDiscounts(["NOPE"], LINES())).rejects.toThrow(/not valid/);
    await expect(resolveDiscounts(["OFF"], LINES())).rejects.toThrow(/not valid/);
    await expect(resolveDiscounts(["PAST"], LINES())).rejects.toThrow(/expired/);
    await expect(resolveDiscounts(["SOON"], LINES())).rejects.toThrow(/not active yet/);
  });

  it("enforces minimum spend", async () => {
    await mkDiscount({ code: "MIN", minSpend: 10_000 });
    await expect(resolveDiscounts(["MIN"], LINES())).rejects.toThrow(/minimum spend/);
  });

  it("scopes to targeted products", async () => {
    const d = await mkDiscount({ code: "AONLY", type: "percent", value: 50, appliesTo: "products" });
    await db.insert(discountProducts).values({ discountId: d.id, productId: productA });
    const result = await resolveDiscounts(["AONLY"], LINES());
    expect(result.discountTotal).toBe(2000); // 50% of product A's 4000
  });

  it("scopes to targeted categories", async () => {
    const [cat] = await db.insert(categories).values({ name: "Cat", slug: "cat" }).returning();
    await db.insert(productCategories).values({ productId: productB, categoryId: cat!.id });
    const d = await mkDiscount({ code: "CATS", type: "percent", value: 100, appliesTo: "categories" });
    await db.insert(discountCategories).values({ discountId: d.id, categoryId: cat!.id });
    const result = await resolveDiscounts(["CATS"], LINES());
    expect(result.discountTotal).toBe(1000); // all of product B
  });

  it("rejects a scoped code that matches nothing in the cart", async () => {
    const d = await mkDiscount({ code: "SCOPED", appliesTo: "products" });
    void d; // no product targets linked
    await expect(resolveDiscounts(["SCOPED"], LINES())).rejects.toThrow(/doesn't apply/);
  });

  it("stacking: only all-stackable combinations pass; total is capped", async () => {
    await mkDiscount({ code: "S1", type: "percent", value: 60, stackable: true });
    await mkDiscount({ code: "S2", type: "percent", value: 60, stackable: true });
    await mkDiscount({ code: "SOLO", type: "percent", value: 10, stackable: false });

    const stacked = await resolveDiscounts(["S1", "S2"], LINES());
    expect(stacked.discountTotal).toBe(5000); // 3000 + 3000 capped at subtotal

    await expect(resolveDiscounts(["S1", "SOLO"], LINES())).rejects.toThrow(/can't be combined/);
  });

  it("enforces global usage limits", async () => {
    const d = await mkDiscount({ code: "ONCE", usageLimit: 1 });
    const [order] = await db
      .insert(orders)
      .values({ orderNumber: "ORD-1", email: "x@x.com", subtotal: 1, grandTotal: 1, currency: "USD" })
      .returning();
    await db.insert(discountRedemptions).values({ discountId: d.id, orderId: order!.id });

    await expect(resolveDiscounts(["ONCE"], LINES())).rejects.toThrow(/usage limit/);
  });

  it("enforces per-customer limits for signed-in customers only", async () => {
    const d = await mkDiscount({ code: "PERC", perCustomerLimit: 1 });
    const [customer] = await db
      .insert(customers)
      .values({ email: "c@example.com" })
      .returning();
    const [order] = await db
      .insert(orders)
      .values({ orderNumber: "ORD-2", email: "c@example.com", subtotal: 1, grandTotal: 1, currency: "USD" })
      .returning();
    await db
      .insert(discountRedemptions)
      .values({ discountId: d.id, orderId: order!.id, customerId: customer!.id });

    await expect(resolveDiscounts(["PERC"], LINES(), customer!.id)).rejects.toThrow(
      /maximum number of times/,
    );
    // Guests aren't blocked by per-customer limits.
    const guest = await resolveDiscounts(["PERC"], LINES(), null);
    expect(guest.discountTotal).toBe(500);
  });
});

describe("recordDiscountRedemptions", () => {
  it("records once per discount+order (idempotent)", async () => {
    const d = await mkDiscount({ code: "REC" });
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: "ORD-3",
        email: "x@x.com",
        subtotal: 1000,
        grandTotal: 900,
        currency: "USD",
        discountCode: "REC",
      })
      .returning();

    await recordDiscountRedemptions(order!.id);
    await recordDiscountRedemptions(order!.id); // duplicate webhook

    const rows = await db.select().from(discountRedemptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.discountId).toBe(d.id);
  });
});
