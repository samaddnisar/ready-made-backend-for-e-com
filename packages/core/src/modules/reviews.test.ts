import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { customers, orderItems, orders, products, productVariants, reviews } from "../db/schema";
import {
  deleteReview,
  listPublicReviews,
  listReviewsAdmin,
  moderateReview,
  submitReview,
} from "./reviews";

let db: Db;

let seq = 0;

async function mkProduct(
  overrides: Partial<typeof products.$inferInsert> = {},
): Promise<{ product: typeof products.$inferSelect; variant: typeof productVariants.$inferSelect }> {
  seq += 1;
  const [product] = await db
    .insert(products)
    .values({ title: "Widget", slug: `widget-${seq}`, status: "active", ...overrides })
    .returning();
  const [variant] = await db
    .insert(productVariants)
    .values({ productId: product!.id, title: "Default", price: 1000 })
    .returning();
  return { product: product!, variant: variant! };
}

async function mkCustomer(
  overrides: Partial<typeof customers.$inferInsert> = {},
): Promise<typeof customers.$inferSelect> {
  seq += 1;
  const [row] = await db
    .insert(customers)
    .values({ email: `c${seq}@example.com`, firstName: "Jane", lastName: "Doe", ...overrides })
    .returning();
  return row!;
}

async function mkPaidOrder(
  customerId: string,
  variantId: string,
  status: typeof orders.$inferInsert.status = "paid",
): Promise<typeof orders.$inferSelect> {
  seq += 1;
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-${seq}-${Math.floor(Math.random() * 1e9)}`,
      email: "buyer@example.com",
      customerId,
      status,
      subtotal: 1000,
      grandTotal: 1000,
      currency: "USD",
    })
    .returning();
  await db.insert(orderItems).values({
    orderId: order!.id,
    variantId,
    productTitle: "Widget",
    unitPrice: 1000,
    quantity: 1,
  });
  return order!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(reviews);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(productVariants);
  await db.delete(products);
  await db.delete(customers);
});

describe("submitReview", () => {
  it("creates a pending review and flags a verified purchase (orderId set)", async () => {
    const { product, variant } = await mkProduct();
    const customer = await mkCustomer();
    const order = await mkPaidOrder(customer.id, variant.id);

    const review = await submitReview(customer.id, {
      productId: product.id,
      rating: 5,
      title: "Great",
      body: "Love it",
    });

    expect(review.status).toBe("pending");
    expect(review.rating).toBe(5);
    expect(review.orderId).toBe(order.id);
  });

  it("leaves orderId null without a paid order for the product", async () => {
    const { product, variant } = await mkProduct();
    const customer = await mkCustomer();
    // A pending (unpaid) order does not count as a verified purchase.
    await mkPaidOrder(customer.id, variant.id, "pending");

    const review = await submitReview(customer.id, { productId: product.id, rating: 3 });
    expect(review.orderId).toBeNull();
  });

  it("ignores other customers' orders for verification", async () => {
    const { product, variant } = await mkProduct();
    const buyer = await mkCustomer();
    const reviewer = await mkCustomer();
    await mkPaidOrder(buyer.id, variant.id);

    const review = await submitReview(reviewer.id, { productId: product.id, rating: 4 });
    expect(review.orderId).toBeNull();
  });

  it("404s for draft or soft-deleted products", async () => {
    const { product: draft } = await mkProduct({ status: "draft" });
    const { product: deleted } = await mkProduct({ deletedAt: new Date() });
    const customer = await mkCustomer();

    await expect(submitReview(customer.id, { productId: draft.id, rating: 4 })).rejects.toThrow(
      /not found/i,
    );
    await expect(submitReview(customer.id, { productId: deleted.id, rating: 4 })).rejects.toThrow(
      /not found/i,
    );
  });

  it("rejects a second review for the same product with a friendly 409", async () => {
    const { product } = await mkProduct();
    const customer = await mkCustomer();

    await submitReview(customer.id, { productId: product.id, rating: 5 });
    await expect(submitReview(customer.id, { productId: product.id, rating: 1 })).rejects.toThrow(
      /already reviewed/i,
    );
  });
});

describe("listPublicReviews", () => {
  it("shows approved reviews only, with anonymized names and rating summary", async () => {
    const { product, variant } = await mkProduct();
    const jane = await mkCustomer({ firstName: "Jane", lastName: "Doe" });
    const bob = await mkCustomer({ firstName: "Bob", lastName: "Smith" });
    const anon = await mkCustomer({ firstName: null, lastName: null });
    await mkPaidOrder(jane.id, variant.id);

    const janeReview = await submitReview(jane.id, {
      productId: product.id,
      rating: 5,
      title: "Great",
    });
    const bobReview = await submitReview(bob.id, { productId: product.id, rating: 2 });
    // Stays pending — must not appear or count.
    await submitReview(anon.id, { productId: product.id, rating: 1 });

    await moderateReview(janeReview.id, "approved");
    await moderateReview(bobReview.id, "approved");

    const result = await listPublicReviews(product.slug, { page: 1, pageSize: 10 });
    expect(result.total).toBe(2);
    expect(result.summary.reviewCount).toBe(2);
    expect(result.summary.averageRating).toBe(3.5); // (5 + 2) / 2

    const names = result.items.map((r) => r.customerName).sort();
    expect(names).toEqual(["Bob S.", "Jane D."]);

    const verified = result.items.find((r) => r.customerName === "Jane D.")!;
    expect(verified.verifiedPurchase).toBe(true);
    expect(result.items.find((r) => r.customerName === "Bob S.")!.verifiedPurchase).toBe(false);
  });

  it("returns an empty page with a zeroed summary when nothing is approved", async () => {
    const { product } = await mkProduct();
    const customer = await mkCustomer();
    await submitReview(customer.id, { productId: product.id, rating: 4 });

    const result = await listPublicReviews(product.slug, { page: 1, pageSize: 10 });
    expect(result.items).toEqual([]);
    expect(result.summary).toEqual({ averageRating: 0, reviewCount: 0 });
  });

  it("404s for an unknown or non-active product slug", async () => {
    const { product } = await mkProduct({ status: "draft" });
    await expect(listPublicReviews(product.slug, { page: 1, pageSize: 10 })).rejects.toThrow(
      /not found/i,
    );
    await expect(listPublicReviews("nope", { page: 1, pageSize: 10 })).rejects.toThrow(/not found/i);
  });
});

describe("moderation", () => {
  it("transitions pending → approved → rejected and filters the admin list", async () => {
    const { product } = await mkProduct({ title: "Nice Widget" });
    const customer = await mkCustomer();
    const review = await submitReview(customer.id, { productId: product.id, rating: 4 });

    const approved = await moderateReview(review.id, "approved");
    expect(approved.status).toBe("approved");

    const approvedList = await listReviewsAdmin({ page: 1, pageSize: 10, status: "approved" });
    expect(approvedList.total).toBe(1);
    expect(approvedList.items[0]!.id).toBe(review.id);
    expect(approvedList.items[0]!.productTitle).toBe("Nice Widget");

    const rejected = await moderateReview(review.id, "rejected");
    expect(rejected.status).toBe("rejected");
    expect((await listReviewsAdmin({ page: 1, pageSize: 10, status: "approved" })).total).toBe(0);
    expect((await listReviewsAdmin({ page: 1, pageSize: 10, status: "rejected" })).total).toBe(1);
  });

  it("searches the admin list by product title", async () => {
    const { product: widget } = await mkProduct({ title: "Blue Widget" });
    const { product: gadget } = await mkProduct({ title: "Red Gadget" });
    const customer = await mkCustomer();
    await submitReview(customer.id, { productId: widget.id, rating: 4 });
    await submitReview(customer.id, { productId: gadget.id, rating: 2 });

    const hits = await listReviewsAdmin({ page: 1, pageSize: 10, q: "gadget" });
    expect(hits.total).toBe(1);
    expect(hits.items[0]!.productId).toBe(gadget.id);
  });

  it("404s when moderating a missing review", async () => {
    await expect(
      moderateReview("00000000-0000-4000-8000-000000000000", "approved"),
    ).rejects.toThrow(/not found/i);
  });
});

describe("deleteReview", () => {
  it("hard-deletes and 404s on repeat", async () => {
    const { product } = await mkProduct();
    const customer = await mkCustomer();
    const review = await submitReview(customer.id, { productId: product.id, rating: 4 });

    await deleteReview(review.id);
    expect((await listReviewsAdmin({ page: 1, pageSize: 10 })).total).toBe(0);
    await expect(deleteReview(review.id)).rejects.toThrow(/not found/i);
  });
});
