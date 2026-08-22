import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { carts, orderItems, orders, payments, refunds, webhookEvents } from "../db/schema";
import { consumeOrderStock, releaseCartReservations } from "../inventory/service";
import { transitionOrder } from "../orders/state-machine";

/**
 * Stripe webhook processing (§6/§9). The route verifies the signature and
 * hands the parsed event here. Everything in this module is:
 *  - idempotent: the webhook_events (source, event_id) unique row is the
 *    guard — duplicates skip; failed events may be retried by Stripe.
 *  - exactly-once for side effects: stock consumption and emails key off
 *    the actual pending→paid transition, not off event delivery.
 */

export type StripeEventLike = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export type WebhookOutcome = {
  received: true;
  duplicate?: boolean;
  handled?: boolean;
  orderId?: string;
  /** Email the route should send (kept out of core — Resend lives app-side). */
  email?: "order_confirmation" | "payment_failed" | null;
  /**
   * Money arrived in a state we won't auto-resolve (paid after cancel,
   * amount mismatch). The payment is recorded; an admin must reconcile
   * (refund or manually fulfil). Never triggers an infinite retry.
   */
  reconciliation?: "paid_after_cancelled" | "amount_mismatch";
};

/** Returns false when this event was already processed (skip), true to proceed. */
async function claimEvent(event: StripeEventLike): Promise<boolean> {
  const db = getDb();
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ source: "stripe", eventId: event.id, type: event.type, payload: event.data })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted) return true;

  // Row exists: reprocess only if the previous attempt failed.
  const existing = await db.query.webhookEvents.findFirst({
    where: and(eq(webhookEvents.source, "stripe"), eq(webhookEvents.eventId, event.id)),
  });
  if (!existing || existing.status === "processed" || existing.status === "skipped") return false;
  return true;
}

async function markEvent(
  eventId: string,
  status: "processed" | "failed" | "skipped",
  error?: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(webhookEvents)
    .set({ status, error: error ?? null, processedAt: new Date() })
    .where(and(eq(webhookEvents.source, "stripe"), eq(webhookEvents.eventId, eventId)));
}

export async function processStripeEvent(event: StripeEventLike): Promise<WebhookOutcome> {
  const proceed = await claimEvent(event);
  if (!proceed) return { received: true, duplicate: true };

  try {
    let outcome: WebhookOutcome;
    switch (event.type) {
      case "payment_intent.succeeded":
        outcome = await handlePaymentSucceeded(event);
        break;
      case "payment_intent.payment_failed":
      case "payment_intent.canceled":
        outcome = await handlePaymentFailed(event);
        break;
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
      case "charge.refund.updated":
        outcome = await handleRefundUpdated(event);
        break;
      default:
        await markEvent(event.id, "skipped");
        return { received: true, handled: false };
    }
    await markEvent(event.id, "processed");
    return outcome;
  } catch (err) {
    await markEvent(event.id, "failed", err instanceof Error ? err.message : String(err));
    throw err; // route returns 500 → Stripe retries → claimEvent allows the retry
  }
}

async function findPaymentByIntent(paymentIntentId: string) {
  const db = getDb();
  return db.query.payments.findFirst({
    where: eq(payments.stripePaymentIntentId, paymentIntentId),
  });
}

async function handlePaymentSucceeded(event: StripeEventLike): Promise<WebhookOutcome> {
  const db = getDb();
  const intent = event.data.object as {
    id: string;
    amount_received?: number;
    currency?: string;
    payment_method_types?: string[];
  };

  // ONLY our own recorded PaymentIntents count. No metadata fallback: a PI
  // from another integration on the same Stripe account must never be able
  // to flip an order to paid (metadata is attacker-influenceable there).
  const payment = await findPaymentByIntent(intent.id);
  if (!payment) return { received: true, handled: false };
  const orderId = payment.orderId;

  await db
    .update(payments)
    .set({
      status: "succeeded",
      method: intent.payment_method_types?.[0] ?? payment.method,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

  // The charged amount must match what we quoted (§9). A mismatch is never
  // auto-marked paid — it is flagged for reconciliation.
  const amountMismatch =
    (intent.amount_received !== undefined && intent.amount_received !== payment.amount) ||
    (intent.currency !== undefined &&
      intent.currency.toLowerCase() !== payment.currency.toLowerCase());
  if (amountMismatch) {
    console.error(
      `[stripe] amount/currency mismatch on ${intent.id}: charged ${intent.amount_received} ${intent.currency}, expected ${payment.amount} ${payment.currency} (order ${orderId})`,
    );
    return { received: true, handled: true, orderId, email: null, reconciliation: "amount_mismatch" };
  }

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return { received: true, handled: false };

  if (order.status === "paid") {
    // Duplicate delivery under a new event id — nothing more to do.
    return { received: true, handled: true, orderId, email: null };
  }

  if (order.status === "cancelled") {
    // Money arrived for an order we cancelled (stale client secret). Record
    // it and surface for admin reconciliation — never an infinite retry.
    console.error(`[stripe] payment succeeded for cancelled order ${order.orderNumber} (${orderId})`);
    return {
      received: true,
      handled: true,
      orderId,
      email: null,
      reconciliation: "paid_after_cancelled",
    };
  }

  // Atomic: status flip(s) + stock consumption + cart conversion commit
  // together, keyed on the pending→paid transition (exactly-once).
  await db.transaction(async (tx) => {
    if (order.status === "payment_failed") {
      // Declined attempt retried successfully on the same PaymentIntent —
      // recover through the legal payment_failed→pending edge.
      await transitionOrder(orderId, "pending", "webhook:stripe", "Payment retried", tx);
    }
    const result = await transitionOrder(orderId, "paid", "webhook:stripe", undefined, tx);
    if (result.fromStatus === "paid") return;

    const items = await tx
      .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    // Consumes live holds first; falls back to direct decrement when the
    // holds were released (declined attempt) or swept (TTL expiry).
    await consumeOrderStock(orderId, order.cartId, items, tx);

    if (order.cartId) {
      await tx
        .update(carts)
        .set({ status: "converted", updatedAt: new Date() })
        .where(eq(carts.id, order.cartId));
    }
  });

  const { recordDiscountRedemptions } = await import("../promotions/service");
  await recordDiscountRedemptions(orderId).catch((err) =>
    console.error("[stripe] failed to record discount redemptions", err),
  );

  return { received: true, handled: true, orderId, email: "order_confirmation" };
}

async function handlePaymentFailed(event: StripeEventLike): Promise<WebhookOutcome> {
  const db = getDb();
  const intent = event.data.object as { id: string };

  // Same trust boundary as the succeeded handler: our recorded PIs only.
  const payment = await findPaymentByIntent(intent.id);
  if (!payment) return { received: true, handled: false };
  const orderId = payment.orderId;

  await db
    .update(payments)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(payments.id, payment.id));

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return { received: true, handled: false };

  // Only a still-pending order flips; a paid order is never demoted by a
  // late/duplicate failure event.
  if (order.status === "pending") {
    await db.transaction(async (tx) => {
      await transitionOrder(orderId, "payment_failed", "webhook:stripe", "Stripe payment failed", tx);
      if (order.cartId) await releaseCartReservations(order.cartId, tx);
    });
    return { received: true, handled: true, orderId, email: "payment_failed" };
  }
  return { received: true, handled: true, orderId, email: null };
}

async function handleRefundUpdated(event: StripeEventLike): Promise<WebhookOutcome> {
  const db = getDb();
  const refund = event.data.object as {
    id: string;
    status?: string;
    amount?: number;
    reason?: string | null;
    payment_intent?: string | null;
  };

  const status =
    refund.status === "succeeded"
      ? "succeeded"
      : refund.status === "failed"
        ? "failed"
        : refund.status === "canceled"
          ? "cancelled"
          : "pending";

  let row = await db.query.refunds.findFirst({ where: eq(refunds.stripeRefundId, refund.id) });

  if (!row) {
    // Refund issued outside the admin (Stripe Dashboard/API). Record it so
    // local refundable totals and order status never silently diverge.
    if (!refund.payment_intent || typeof refund.amount !== "number") {
      return { received: true, handled: false };
    }
    const payment = await findPaymentByIntent(refund.payment_intent);
    if (!payment) return { received: true, handled: false };
    const [inserted] = await db
      .insert(refunds)
      .values({
        paymentId: payment.id,
        amount: refund.amount,
        reason: refund.reason ?? "Issued via Stripe Dashboard",
        stripeRefundId: refund.id,
        status,
        adminUserId: null,
      })
      .onConflictDoNothing()
      .returning();
    row = inserted ?? (await db.query.refunds.findFirst({ where: eq(refunds.stripeRefundId, refund.id) }));
    if (!row) return { received: true, handled: false };
  } else {
    await db
      .update(refunds)
      .set({ status, updatedAt: new Date() })
      .where(eq(refunds.id, row.id));
  }

  // Order-level refund status is recomputed by the orders service.
  const { syncOrderRefundStatus } = await import("../orders/service");
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, row.paymentId) });
  if (payment) await syncOrderRefundStatus(payment.orderId, "webhook:stripe");

  return { received: true, handled: true };
}
