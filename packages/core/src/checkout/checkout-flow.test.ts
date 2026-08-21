import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import {
  cartItems,
  carts,
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  orderStatusHistory,
  payments,
  products,
  productVariants,
  refunds,
  settings,
  webhookEvents,
} from "../db/schema";
import { AppError } from "../errors";
import { invalidateSettingsCache } from "../settings/service";
import { addCartItem, createCart } from "../cart/service";
import { prepareCheckout, recordPaymentIntent, abortCheckout } from "./service";
import { processStripeEvent } from "../webhooks/stripe";
import { getRefundContext, recordRefund } from "../orders/service";

let db: Db;
let variantId: string;

const ADMIN = "11111111-1111-4111-8111-111111111111";
const shippingAddress = {
  line1: "1 Test St",
  city: "Testville",
  postalCode: "12345",
  country: "US",
};

async function seedCatalog() {
  const [product] = await db
    .insert(products)
    .values({ title: "Widget", slug: "widget", status: "active" })
    .returning();
  const [variant] = await db
    .insert(productVariants)
    .values({ productId: product!.id, price: 2500, sku: "W-1" })
    .returning();
  variantId = variant!.id;
  await db.insert(inventory).values({ variantId, quantity: 5, trackInventory: true });
}

async function cartWith(quantity: number): Promise<string> {
  const cart = await createCart();
  await addCartItem(cart.token, { variantId, quantity });
  return cart.token;
}

async function checkout(token: string) {
  return prepareCheckout({ cartToken: token, email: "buyer@example.com", shippingAddress });
}

function paymentSucceededEvent(eventId: string, paymentIntentId: string, orderId: string) {
  return {
    id: eventId,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: paymentIntentId,
        metadata: { order_id: orderId },
        payment_method_types: ["card"],
      },
    },
  };
}

async function getInv() {
  const [row] = await db.select().from(inventory).where(eq(inventory.variantId, variantId));
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  for (const table of [
    webhookEvents,
    refunds,
    payments,
    orderStatusHistory,
    orderItems,
    inventoryReservations,
    orders,
    cartItems,
    carts,
    inventory,
    productVariants,
    products,
    settings,
  ]) {
    await db.delete(table);
  }
  invalidateSettingsCache();
  await seedCatalog();
});

describe("prepareCheckout", () => {
  it("creates a pending order with snapshots, totals, and stock holds", async () => {
    const token = await cartWith(2);
    const { order, totals } = await checkout(token);

    expect(order.status).toBe("pending");
    expect(order.orderNumber).toMatch(/^ORD-\d+$/);
    expect(totals.subtotal).toBe(5000);
    expect(totals.grandTotal).toBe(5000);
    expect(order.email).toBe("buyer@example.com");
    expect(order.shippingAddress?.line1).toBe("1 Test St");
    expect(order.billingAddress?.line1).toBe("1 Test St"); // defaults to shipping

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.productTitle).toBe("Widget");
    expect(items[0]!.unitPrice).toBe(2500);
    expect(items[0]!.quantity).toBe(2);

    expect((await getInv()).reservedQty).toBe(2);
  });

  it("rejects an empty cart", async () => {
    const cart = await createCart();
    await expect(checkout(cart.token)).rejects.toThrow(/empty/i);
  });

  it("rejects when stock is insufficient", async () => {
    const token = await cartWith(6);
    await expect(checkout(token)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "out_of_stock",
    );
    expect((await getInv()).reservedQty).toBe(0);
  });

  it("rejects an expired cart with cart_expired", async () => {
    const token = await cartWith(1);
    await db
      .update(carts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(carts.sessionToken, token));
    await expect(checkout(token)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "cart_expired",
    );
  });

  it("supersedes a previous pending order on re-checkout without stacking holds", async () => {
    const token = await cartWith(2);
    const first = await checkout(token);
    const second = await checkout(token);

    const [firstRow] = await db.select().from(orders).where(eq(orders.id, first.order.id));
    expect(firstRow!.status).toBe("cancelled");
    expect(second.order.status).toBe("pending");
    expect((await getInv()).reservedQty).toBe(2); // replaced, not 4
  });

  it("abortCheckout releases holds and cancels the order", async () => {
    const token = await cartWith(2);
    const { order, cartId } = await checkout(token);
    await abortCheckout(order.id, cartId);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("cancelled");
    expect((await getInv()).reservedQty).toBe(0);
  });
});

describe("webhook: payment_intent.succeeded", () => {
  it("marks paid, consumes stock exactly once, converts the cart", async () => {
    const token = await cartWith(2);
    const { order, totals, cartId } = await checkout(token);
    await recordPaymentIntent(order.id, "pi_1", totals.grandTotal, order.currency);

    const outcome = await processStripeEvent(paymentSucceededEvent("evt_1", "pi_1", order.id));
    expect(outcome.email).toBe("order_confirmation");

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("paid");

    const inv = await getInv();
    expect(inv.quantity).toBe(3);
    expect(inv.reservedQty).toBe(0);

    const [cart] = await db.select().from(carts).where(eq(carts.id, cartId));
    expect(cart!.status).toBe("converted");

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.stripePaymentIntentId, "pi_1"));
    expect(payment!.status).toBe("succeeded");
  });

  it("ignores an exact duplicate event (same event id)", async () => {
    const token = await cartWith(2);
    const { order, totals } = await checkout(token);
    await recordPaymentIntent(order.id, "pi_1", totals.grandTotal, order.currency);

    await processStripeEvent(paymentSucceededEvent("evt_1", "pi_1", order.id));
    const dup = await processStripeEvent(paymentSucceededEvent("evt_1", "pi_1", order.id));
    expect(dup.duplicate).toBe(true);
    expect((await getInv()).quantity).toBe(3); // not decremented twice
  });

  it("does not double-consume when Stripe re-sends under a new event id", async () => {
    const token = await cartWith(2);
    const { order, totals } = await checkout(token);
    await recordPaymentIntent(order.id, "pi_1", totals.grandTotal, order.currency);

    await processStripeEvent(paymentSucceededEvent("evt_1", "pi_1", order.id));
    const second = await processStripeEvent(paymentSucceededEvent("evt_2", "pi_1", order.id));
    expect(second.email).toBeNull(); // no second confirmation email

    const inv = await getInv();
    expect(inv.quantity).toBe(3);
    expect(inv.reservedQty).toBe(0);
  });

  it("ignores unknown PaymentIntents", async () => {
    const outcome = await processStripeEvent({
      id: "evt_x",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_unknown" } },
    });
    expect(outcome.handled).toBe(false);
  });
});

describe("webhook: payment_intent.payment_failed", () => {
  it("flips a pending order to payment_failed and releases holds", async () => {
    const token = await cartWith(2);
    const { order, totals } = await checkout(token);
    await recordPaymentIntent(order.id, "pi_1", totals.grandTotal, order.currency);

    const outcome = await processStripeEvent({
      id: "evt_f1",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_1", metadata: { order_id: order.id } } },
    });
    expect(outcome.email).toBe("payment_failed");

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("payment_failed");
    expect((await getInv()).reservedQty).toBe(0);
  });

  it("never demotes an already-paid order on a late failure event", async () => {
    const token = await cartWith(2);
    const { order, totals } = await checkout(token);
    await recordPaymentIntent(order.id, "pi_1", totals.grandTotal, order.currency);
    await processStripeEvent(paymentSucceededEvent("evt_1", "pi_1", order.id));

    await processStripeEvent({
      id: "evt_late",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_1", metadata: { order_id: order.id } } },
    });
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("paid");
    expect((await getInv()).quantity).toBe(3); // consumption stands
  });
});

describe("refunds", () => {
  async function paidOrder() {
    const token = await cartWith(2);
    const { order, totals } = await checkout(token);
    await recordPaymentIntent(order.id, "pi_1", totals.grandTotal, order.currency);
    await processStripeEvent(paymentSucceededEvent("evt_1", "pi_1", order.id));
    return order;
  }

  it("partial refund marks partially_refunded and tracks the remainder", async () => {
    const order = await paidOrder();
    const ctx = await getRefundContext(order.id);
    expect(ctx.refundableTotal).toBe(5000);

    await recordRefund(
      ctx.payment.id,
      { amount: 2000, reason: "One item returned", stripeRefundId: "re_1", status: "succeeded" },
      ADMIN,
    );

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("partially_refunded");
    expect((await getRefundContext(order.id)).refundableTotal).toBe(3000);
  });

  it("refunding the remainder marks the order refunded", async () => {
    const order = await paidOrder();
    const ctx = await getRefundContext(order.id);
    await recordRefund(
      ctx.payment.id,
      { amount: 2000, stripeRefundId: "re_1", status: "succeeded" },
      ADMIN,
    );
    await recordRefund(
      ctx.payment.id,
      { amount: 3000, stripeRefundId: "re_2", status: "succeeded" },
      ADMIN,
    );

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("refunded");
    expect((await getRefundContext(order.id)).refundableTotal).toBe(0);
  });

  it("rejects a refund exceeding the refundable amount", async () => {
    const order = await paidOrder();
    const ctx = await getRefundContext(order.id);
    await recordRefund(
      ctx.payment.id,
      { amount: 4000, stripeRefundId: "re_1", status: "succeeded" },
      ADMIN,
    );
    await expect(
      recordRefund(
        ctx.payment.id,
        { amount: 2000, stripeRefundId: "re_2", status: "succeeded" },
        ADMIN,
      ),
    ).rejects.toThrow(/exceeds/);
  });

  it("pending refunds count against the refundable amount", async () => {
    const order = await paidOrder();
    const ctx = await getRefundContext(order.id);
    await recordRefund(
      ctx.payment.id,
      { amount: 3000, stripeRefundId: "re_1", status: "pending" },
      ADMIN,
    );
    expect((await getRefundContext(order.id)).refundableTotal).toBe(2000);
  });

  it("refund on an unpaid order is rejected", async () => {
    const token = await cartWith(1);
    const { order } = await checkout(token);
    await expect(getRefundContext(order.id)).rejects.toThrow(/no successful payment/);
  });
});
