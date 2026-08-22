import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  cartItems,
  carts,
  orderItems,
  orders,
  payments,
  productImages,
  products,
  productVariants,
} from "../db/schema";
import { AppError, badRequest, notFound } from "../errors";
import {
  releaseCartReservations,
  releaseExpiredReservations,
  reserveStock,
} from "../inventory/service";
import { transitionOrder } from "../orders/state-machine";
import { computeTotals, type Totals } from "./totals";
import type { CheckoutInput } from "../validation/checkout";

/** Stripe won't create sub-$0.50 PaymentIntents; fail early and clearly. */
export const MINIMUM_CHARGE_MINOR_UNITS = 50;

export type CheckoutPreparation = {
  order: typeof orders.$inferSelect;
  totals: Totals;
  cartId: string;
  /**
   * PaymentIntents belonging to orders this checkout superseded. The route
   * must cancel them at Stripe (best-effort) so stale client secrets from
   * an earlier checkout attempt can no longer capture money.
   */
  stalePaymentIntentIds: string[];
};

/**
 * Checkout start (§5/§6): validate the cart, reserve stock, create the
 * pending order with full item/address snapshots. The caller (route)
 * then creates the Stripe PaymentIntent for totals.grandTotal and
 * records it via recordPaymentIntent — or aborts with abortCheckout.
 */
export async function prepareCheckout(input: CheckoutInput): Promise<CheckoutPreparation> {
  const db = getDb();

  // Opportunistic sweep so stock held by dead checkouts frees up first.
  await releaseExpiredReservations().catch(() => 0);

  const cart = await db.query.carts.findFirst({
    where: eq(carts.sessionToken, input.cartToken),
  });
  if (!cart) throw notFound("Cart not found");
  if (cart.status === "converted") throw badRequest("This cart has already been checked out");
  if (cart.expiresAt < new Date() || cart.status !== "active") {
    throw new AppError("cart_expired", "This cart has expired — start a new one");
  }

  const items = await db
    .select({
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      unitPrice: cartItems.unitPrice,
      productTitle: products.title,
      productStatus: products.status,
      productDeleted: products.deletedAt,
      variantTitle: productVariants.title,
      variantDeleted: productVariants.deletedAt,
      sku: productVariants.sku,
      productId: products.id,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(cartItems.createdAt));

  if (items.length === 0) throw badRequest("Cart is empty");

  const unavailable = items.filter(
    (i) => i.productDeleted !== null || i.variantDeleted !== null || i.productStatus !== "active",
  );
  if (unavailable.length > 0) {
    throw new AppError(
      "out_of_stock",
      "Some items are no longer available",
      unavailable.map((i) => ({ variantId: i.variantId, title: i.productTitle })),
    );
  }

  const totals = computeTotals({ items });
  if (totals.grandTotal < MINIMUM_CHARGE_MINOR_UNITS) {
    throw new AppError("payment_error", "Order total is below the minimum chargeable amount");
  }

  // Throws out_of_stock (all-or-nothing) on shortage; re-reserves on retry.
  await reserveStock(cart.id, items);

  const imageByProduct = new Map<string, string>();
  const images = await db
    .select({ productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(inArray(productImages.productId, [...new Set(items.map((i) => i.productId))]))
    .orderBy(asc(productImages.position));
  for (const img of images) {
    if (!imageByProduct.has(img.productId)) imageByProduct.set(img.productId, img.url);
  }

  const { order, stalePaymentIntentIds } = await db.transaction(async (tx) => {
    // Serialize checkouts per cart: the row lock makes concurrent
    // prepareCheckout calls queue, so exactly one pending order survives.
    const [lockedCart] = await tx.select().from(carts).where(eq(carts.id, cart.id)).for("update");
    if (!lockedCart || lockedCart.status !== "active" || lockedCart.expiresAt < new Date()) {
      throw new AppError("cart_expired", "This cart is no longer available for checkout");
    }

    // A re-submitted checkout supersedes this cart's earlier pending or
    // failed order — and its PaymentIntent must die with it.
    const stale = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(eq(orders.cartId, cart.id), inArray(orders.status, ["pending", "payment_failed"])),
      );
    for (const s of stale) {
      await transitionOrder(s.id, "cancelled", "system", "Superseded by a new checkout", tx);
    }
    const stalePIs =
      stale.length > 0
        ? await tx
            .select({ id: payments.stripePaymentIntentId, status: payments.status })
            .from(payments)
            .where(
              inArray(
                payments.orderId,
                stale.map((s) => s.id),
              ),
            )
        : [];

    // Via select() rather than execute() — postgres-js and PGlite disagree
    // on execute()'s return shape, and tests run on PGlite.
    const [seq] = await tx
      .select({ n: sql<string>`nextval('order_number_seq')` })
      .from(sql`(select 1) as _seq`);
    const orderNumber = `ORD-${seq?.n ?? Date.now()}`;

    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber,
        email: input.email,
        cartId: cart.id,
        status: "pending",
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shippingTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        currency: cart.currency,
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress ?? input.shippingAddress,
      })
      .returning();
    if (!order) throw new Error("Order insert failed");

    await tx.insert(orderItems).values(
      items.map((i) => ({
        orderId: order.id,
        variantId: i.variantId,
        productTitle: i.productTitle,
        variantTitle: i.variantTitle,
        sku: i.sku,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        imageUrl: imageByProduct.get(i.productId) ?? null,
      })),
    );

    return {
      order,
      stalePaymentIntentIds: stalePIs
        .filter((p) => p.status === "pending" || p.status === "processing")
        .map((p) => p.id),
    };
  });

  return { order, totals, cartId: cart.id, stalePaymentIntentIds };
}

/** Record the PaymentIntent the route created for this order. */
export async function recordPaymentIntent(
  orderId: string,
  paymentIntentId: string,
  amount: number,
  currency: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(payments)
    .values({ orderId, stripePaymentIntentId: paymentIntentId, amount, currency })
    .onConflictDoNothing();
}

/** PaymentIntent creation failed — undo the checkout side effects. */
export async function abortCheckout(orderId: string, cartId: string): Promise<void> {
  await transitionOrder(orderId, "cancelled", "system", "Payment initialization failed").catch(
    () => undefined,
  );
  await releaseCartReservations(cartId).catch(() => undefined);
}
