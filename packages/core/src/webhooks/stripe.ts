import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { carts, orders, payments, refunds, webhookEvents } from "../db/schema";
import { consumeCartReservations, releaseCartReservations } from "../inventory/service";
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
    metadata?: { order_id?: string };
    payment_method_types?: string[];
  };

  const payment = await findPaymentByIntent(intent.id);
  const orderId = payment?.orderId ?? intent.metadata?.order_id;
  if (!orderId) {
    // A PI we didn't create (e.g. another product on the same Stripe account).
    return { received: true, handled: false };
  }

  if (payment) {
    await db
      .update(payments)
      .set({
        status: "succeeded",
        method: intent.payment_method_types?.[0] ?? payment.method,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));
  }

  // Idempotent: an already-paid order returns fromStatus "paid" → no side effects.
  const result = await transitionOrder(orderId, "paid", "webhook:stripe");
  if (result.fromStatus === "paid") {
    return { received: true, handled: true, orderId, email: null };
  }

  if (result.order.cartId) {
    await consumeCartReservations(result.order.cartId, orderId);
    await db
      .update(carts)
      .set({ status: "converted", updatedAt: new Date() })
      .where(eq(carts.id, result.order.cartId));
  }

  return { received: true, handled: true, orderId, email: "order_confirmation" };
}

async function handlePaymentFailed(event: StripeEventLike): Promise<WebhookOutcome> {
  const db = getDb();
  const intent = event.data.object as { id: string; metadata?: { order_id?: string } };

  const payment = await findPaymentByIntent(intent.id);
  const orderId = payment?.orderId ?? intent.metadata?.order_id;
  if (!orderId) return { received: true, handled: false };

  if (payment) {
    await db
      .update(payments)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(payments.id, payment.id));
  }

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return { received: true, handled: false };

  // Only a still-pending order flips; a paid order is never demoted by a
  // late/duplicate failure event.
  if (order.status === "pending") {
    await transitionOrder(orderId, "payment_failed", "webhook:stripe", "Stripe payment failed");
    if (order.cartId) await releaseCartReservations(order.cartId);
    return { received: true, handled: true, orderId, email: "payment_failed" };
  }
  return { received: true, handled: true, orderId, email: null };
}

async function handleRefundUpdated(event: StripeEventLike): Promise<WebhookOutcome> {
  const db = getDb();
  const refund = event.data.object as { id: string; status?: string };
  const row = await db.query.refunds.findFirst({ where: eq(refunds.stripeRefundId, refund.id) });
  if (!row) return { received: true, handled: false };

  const status =
    refund.status === "succeeded"
      ? "succeeded"
      : refund.status === "failed"
        ? "failed"
        : refund.status === "canceled"
          ? "cancelled"
          : "pending";
  await db
    .update(refunds)
    .set({ status, updatedAt: new Date() })
    .where(eq(refunds.id, row.id));

  // Order-level refund status is recomputed by the orders service.
  const { syncOrderRefundStatus } = await import("../orders/service");
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, row.paymentId) });
  if (payment) await syncOrderRefundStatus(payment.orderId, "webhook:stripe");

  return { received: true, handled: true };
}
