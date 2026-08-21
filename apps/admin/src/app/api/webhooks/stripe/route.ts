import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { processStripeEvent, unauthorized } from "@repo/core";
import { fail, ok } from "@/lib/api";
import { sendOrderEmail } from "@/lib/email";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe — Stripe → server, so no same-origin/CSRF check:
 * the webhook signature IS the auth. Processing is idempotent in core
 * (webhook_events dedupe); a processing failure returns 500 so Stripe
 * retries the delivery.
 */
export async function POST(req: NextRequest) {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    if (!sig) throw new Error("Missing stripe-signature header");
    event = getStripe().webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return fail(unauthorized("Invalid signature"));
  }

  try {
    const outcome = await processStripeEvent(event as never);
    // sendOrderEmail never throws — a mail hiccup must not make Stripe retry
    // (the event is already marked processed).
    if (outcome.email && outcome.orderId) await sendOrderEmail(outcome.email, outcome.orderId);
    return ok({ received: true });
  } catch (err) {
    return fail(err); // 500 → Stripe retries; core allows reprocessing failed events
  }
}
