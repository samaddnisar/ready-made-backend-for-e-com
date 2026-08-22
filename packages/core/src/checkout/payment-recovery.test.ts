/**
 * Regression tests for the Phase 4 adversarial-review findings: payment
 * recovery after declines, expired-hold payment, cancelled-order payments,
 * webhook trust boundaries, and race-safe refunds.
 */
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
import { invalidateSettingsCache } from "../settings/service";
import { addCartItem, createCart } from "../cart/service";
import { prepareCheckout, recordPaymentIntent } from "./service";
import { processStripeEvent } from "../webhooks/stripe";
import { releaseExpiredReservations } from "../inventory/service";
import { beginRefund, finalizeRefund, getRefundContext } from "../orders/service";
import { transitionOrder } from "../orders/state-machine";

let db: Db;
let variantId: string;

const ADMIN = "11111111-1111-4111-8111-111111111111";
const shippingAddress = { line1: "1 Test St", city: "Testville", postalCode: "12345", country: "US" };

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

async function checkoutWith(quantity: number) {
  const cart = await createCart();
  await addCartItem(cart.token, { variantId, quantity });
  const prep = await prepareCheckout({
    cartToken: cart.token,
    email: "buyer@example.com",
    shippingAddress,
  });
  await recordPaymentIntent(prep.order.id, "pi_1", prep.totals.grandTotal, prep.order.currency);
  return { ...prep, token: cart.token };
}

function succeeded(eventId: string, pi = "pi_1", extra: Record<string, unknown> = {}) {
  return {
    id: eventId,
    type: "payment_intent.succeeded",
    data: { object: { id: pi, payment_method_types: ["card"], ...extra } },
  };
}

function failed(eventId: string, pi = "pi_1") {
  return { id: eventId, type: "payment_intent.payment_failed", data: { object: { id: pi } } };
}

async function getInv() {
  const [row] = await db.select().from(inventory).where(eq(inventory.variantId, variantId));
  return row!;
}

async function getOrder(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  for (const t of [
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
    await db.delete(t);
  }
  invalidateSettingsCache();
  await seedCatalog();
});

describe("decline-then-retry on the same PaymentIntent (critical finding)", () => {
  it("recovers payment_failed → paid and still decrements stock", async () => {
    const { order } = await checkoutWith(2);

    // Attempt 1 declined: order fails, holds released.
    await processStripeEvent(failed("evt_f1"));
    expect((await getOrder(order.id)).status).toBe("payment_failed");
    expect((await getInv()).reservedQty).toBe(0);

    // Customer retries the same PI and it succeeds.
    const outcome = await processStripeEvent(succeeded("evt_s1"));
    expect(outcome.email).toBe("order_confirmation");

    const after = await getOrder(order.id);
    expect(after.status).toBe("paid");
    // Holds were gone — stock must come from the order-items fallback.
    const inv = await getInv();
    expect(inv.quantity).toBe(3);
    expect(inv.reservedQty).toBe(0);
  });
});

describe("payment landing after the reservation TTL expired", () => {
  it("still decrements stock via the fallback", async () => {
    const { order } = await checkoutWith(2);

    // Sweep the holds as if 30 minutes passed.
    await db
      .update(inventoryReservations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(inventoryReservations.cartId, order.cartId!));
    expect(await releaseExpiredReservations()).toBe(1);
    expect((await getInv()).reservedQty).toBe(0);

    await processStripeEvent(succeeded("evt_s1"));
    expect((await getOrder(order.id)).status).toBe("paid");
    expect((await getInv()).quantity).toBe(3);
  });

  it("clamps at zero and flags oversell when stock was sold elsewhere meanwhile", async () => {
    const { order } = await checkoutWith(4);
    await db
      .update(inventoryReservations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(inventoryReservations.cartId, order.cartId!));
    await releaseExpiredReservations();
    // Meanwhile stock dropped to 1.
    await db.update(inventory).set({ quantity: 1 }).where(eq(inventory.variantId, variantId));

    await processStripeEvent(succeeded("evt_s1"));
    expect((await getOrder(order.id)).status).toBe("paid");
    expect((await getInv()).quantity).toBe(0); // clamped, oversell logged
  });
});

describe("webhook trust boundary", () => {
  it("ignores succeeded events with metadata but no local payments row", async () => {
    const { order } = await checkoutWith(1);
    const outcome = await processStripeEvent(
      succeeded("evt_forged", "pi_foreign", { metadata: { order_id: order.id } }),
    );
    expect(outcome.handled).toBe(false);
    expect((await getOrder(order.id)).status).toBe("pending"); // untouched
  });

  it("flags amount mismatch instead of marking paid", async () => {
    const { order, totals } = await checkoutWith(2);
    const outcome = await processStripeEvent(
      succeeded("evt_s1", "pi_1", { amount_received: totals.grandTotal - 1, currency: "usd" }),
    );
    expect(outcome.reconciliation).toBe("amount_mismatch");
    expect((await getOrder(order.id)).status).toBe("pending");
    expect((await getInv()).quantity).toBe(5); // no consumption
  });

  it("accepts matching amount_received", async () => {
    const { order, totals } = await checkoutWith(2);
    await processStripeEvent(
      succeeded("evt_s1", "pi_1", { amount_received: totals.grandTotal, currency: "usd" }),
    );
    expect((await getOrder(order.id)).status).toBe("paid");
  });
});

describe("payment succeeding for a cancelled order", () => {
  it("records the payment and flags reconciliation instead of retry-looping", async () => {
    const { order } = await checkoutWith(2);
    await transitionOrder(order.id, "cancelled", "system", "test cancel");

    const outcome = await processStripeEvent(succeeded("evt_s1"));
    expect(outcome.reconciliation).toBe("paid_after_cancelled");
    expect(outcome.handled).toBe(true);

    // Event marked processed — Stripe will not retry forever.
    const [evt] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, "evt_s1"));
    expect(evt!.status).toBe("processed");

    // Payment recorded for the admin to see and refund.
    const [payment] = await db.select().from(payments).where(eq(payments.stripePaymentIntentId, "pi_1"));
    expect(payment!.status).toBe("succeeded");
    expect((await getOrder(order.id)).status).toBe("cancelled");
  });
});

describe("supersede sweep", () => {
  it("cancels payment_failed orders too and reports their PaymentIntents", async () => {
    const cart = await createCart();
    await addCartItem(cart.token, { variantId, quantity: 1 });
    const first = await prepareCheckout({
      cartToken: cart.token,
      email: "b@example.com",
      shippingAddress,
    });
    await recordPaymentIntent(first.order.id, "pi_old", first.totals.grandTotal, "USD");
    await processStripeEvent(failed("evt_f1", "pi_old"));
    expect((await getOrder(first.order.id)).status).toBe("payment_failed");

    const second = await prepareCheckout({
      cartToken: cart.token,
      email: "b@example.com",
      shippingAddress,
    });
    expect((await getOrder(first.order.id)).status).toBe("cancelled");
    expect(second.stalePaymentIntentIds).toEqual([]); // pi_old is already failed, not cancellable
    expect(second.order.status).toBe("pending");
  });

  it("reports still-pending PaymentIntents of superseded orders for cancellation", async () => {
    const cart = await createCart();
    await addCartItem(cart.token, { variantId, quantity: 1 });
    const first = await prepareCheckout({
      cartToken: cart.token,
      email: "b@example.com",
      shippingAddress,
    });
    await recordPaymentIntent(first.order.id, "pi_old", first.totals.grandTotal, "USD");

    const second = await prepareCheckout({
      cartToken: cart.token,
      email: "b@example.com",
      shippingAddress,
    });
    expect(second.stalePaymentIntentIds).toEqual(["pi_old"]);
  });
});

describe("race-safe refunds (beginRefund/finalizeRefund)", () => {
  async function paidOrder() {
    const { order, totals } = await checkoutWith(2);
    await processStripeEvent(succeeded("evt_s1"));
    return { order, totals };
  }

  it("reserves the amount before Stripe and finalizes with the result", async () => {
    const { order } = await paidOrder();
    const { refund } = await beginRefund(order.id, { amount: 2000, reason: "test" }, ADMIN);
    expect(refund.status).toBe("pending");
    expect(refund.stripeRefundId).toBeNull();

    // While pending, the reservation already counts against refundable.
    expect((await getRefundContext(order.id)).refundableTotal).toBe(3000);

    await finalizeRefund(refund.id, { stripeRefundId: "re_1", status: "succeeded" }, ADMIN);
    expect((await getOrder(order.id)).status).toBe("partially_refunded");
  });

  it("a second refund can't overshoot while the first is still pending", async () => {
    const { order } = await paidOrder();
    await beginRefund(order.id, { amount: 4000 }, ADMIN);
    await expect(beginRefund(order.id, { amount: 2000 }, ADMIN)).rejects.toThrow(/exceeds/);
  });

  it("a failed Stripe call frees the reserved amount", async () => {
    const { order } = await paidOrder();
    const { refund } = await beginRefund(order.id, { amount: 4000 }, ADMIN);
    await finalizeRefund(refund.id, { status: "failed" }, ADMIN);
    expect((await getRefundContext(order.id)).refundableTotal).toBe(5000);
  });
});

describe("dashboard-initiated refunds arrive via webhook", () => {
  it("creates the missing local refund row and syncs the order", async () => {
    const { order, totals } = await checkoutWith(2);
    await processStripeEvent(succeeded("evt_s1"));

    const outcome = await processStripeEvent({
      id: "evt_r1",
      type: "refund.created",
      data: {
        object: {
          id: "re_dash",
          status: "succeeded",
          amount: totals.grandTotal,
          payment_intent: "pi_1",
        },
      },
    });
    expect(outcome.handled).toBe(true);

    const rows = await db.select().from(refunds).where(eq(refunds.stripeRefundId, "re_dash"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.adminUserId).toBeNull();
    expect((await getOrder(order.id)).status).toBe("refunded");
  });
});
