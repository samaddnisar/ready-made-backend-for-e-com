import {
  AppError,
  abortCheckout,
  checkoutSchema,
  prepareCheckout,
  recordPaymentIntent,
} from "@repo/core";
import { ok, parseBody, withPublicApi } from "@/lib/api";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/checkout — start checkout (§5/§6): validates the cart,
 * reserves stock, creates the pending order with snapshots (all inside
 * prepareCheckout), then creates the Stripe PaymentIntent for the grand
 * total. If Stripe fails, the checkout is aborted (order cancelled,
 * reservations released) so stock is never stranded.
 */
export const POST = withPublicApi(async (req) => {
  const input = await parseBody(req, checkoutSchema);
  const prep = await prepareCheckout(input);

  try {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create({
      amount: prep.totals.grandTotal,
      currency: prep.order.currency.toLowerCase(),
      metadata: { order_id: prep.order.id, cart_id: prep.cartId },
      automatic_payment_methods: { enabled: true },
    });
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
});
