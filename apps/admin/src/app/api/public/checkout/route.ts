import {
  AppError,
  abortCheckout,
  checkoutSchema,
  prepareCheckout,
  recordPaymentIntent,
} from "@repo/core";
import { ok, parseBody, withPublicApi } from "@/lib/api";
import { optionalCustomer } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { withRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/checkout — start checkout (§5/§6): validates the cart,
 * reserves stock, creates the pending order with snapshots (all inside
 * prepareCheckout), then creates the Stripe PaymentIntent for the grand
 * total. If Stripe fails, the checkout is aborted (order cancelled,
 * reservations released) so stock is never stranded.
 */
export const POST = withRateLimit("checkout", 10, 60_000, withPublicApi(async (req) => {
  const customer = await optionalCustomer(req);
  const input = await parseBody(req, checkoutSchema);
  const prep = await prepareCheckout(input, customer?.id);
  const stripe = getStripe();

  // Kill superseded checkouts' PaymentIntents so stale client secrets from
  // an earlier attempt can no longer capture money. Best-effort: an intent
  // that already succeeded/cancelled simply errors and is skipped.
  for (const staleId of prep.stalePaymentIntentIds) {
    try {
      await stripe.paymentIntents.cancel(staleId);
    } catch (err) {
      console.warn(`[checkout] could not cancel stale PaymentIntent ${staleId}`, err);
    }
  }

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: prep.totals.grandTotal,
        currency: prep.order.currency.toLowerCase(),
        metadata: { order_id: prep.order.id, cart_id: prep.cartId },
        automatic_payment_methods: { enabled: true },
      },
      // §9: idempotency key — a network-level retry of this call must not
      // mint a second chargeable intent for the same order.
      { idempotencyKey: `pi-create-${prep.order.id}` },
    );
    await recordPaymentIntent(prep.order.id, intent.id, prep.totals.grandTotal, prep.order.currency);
    return ok({
      orderId: prep.order.id,
      orderNumber: prep.order.orderNumber,
      clientSecret: intent.client_secret,
      amount: prep.totals.grandTotal,
      currency: prep.order.currency,
    });
  } catch (err) {
    console.error("[checkout] PaymentIntent creation failed", err);
    await abortCheckout(prep.order.id, prep.cartId);
    throw new AppError("payment_error", "Could not initialize payment");
  }
}));
