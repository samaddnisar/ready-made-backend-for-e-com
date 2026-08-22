/** Phase 5 integration: discounts + shipping + tax flow through checkout. */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import {
  cartItems,
  carts,
  discountRedemptions,
  discounts,
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  orderStatusHistory,
  payments,
  products,
  productVariants,
  settings,
  shippingRates,
  shippingZones,
  taxSettings,
  webhookEvents,
} from "../db/schema";
import { invalidateSettingsCache } from "../settings/service";
import { addCartItem, applyCartDiscount, createCart, getCartByToken, removeCartDiscount } from "../cart/service";
import { prepareCheckout, recordPaymentIntent } from "./service";
import { processStripeEvent } from "../webhooks/stripe";
import { updateTaxSettings } from "../shipping/service";

let db: Db;
let variantId: string;
let rateId: string;

const shippingAddress = { line1: "1 St", city: "Town", postalCode: "12345", country: "US" };

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  for (const t of [
    webhookEvents,
    discountRedemptions,
    discounts,
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
    shippingRates,
    shippingZones,
    taxSettings,
    settings,
  ]) {
    await db.delete(t);
  }
  invalidateSettingsCache();

  const [product] = await db
    .insert(products)
    .values({ title: "Widget", slug: "widget", status: "active" })
    .returning();
  const [variant] = await db
    .insert(productVariants)
    .values({ productId: product!.id, price: 2500, weightGrams: 200 })
    .returning();
  variantId = variant!.id;
  await db.insert(inventory).values({ variantId, quantity: 10, trackInventory: true });

  const [zone] = await db.insert(shippingZones).values({ name: "US", countries: ["US"] }).returning();
  const [rate] = await db
    .insert(shippingRates)
    .values({ zoneId: zone!.id, name: "Standard", type: "flat", price: 599 })
    .returning();
  rateId = rate!.id;

  await db.insert(discounts).values({ code: "SAVE10", type: "percent", value: 10 });
  await db.insert(discounts).values({ code: "SHIPFREE", type: "free_shipping", value: 0 });
});

async function cartWith(quantity: number) {
  const cart = await createCart();
  await addCartItem(cart.token, { variantId, quantity });
  return cart.token;
}

describe("cart discounts", () => {
  it("apply/remove reflects projected totals on the cart view", async () => {
    const token = await cartWith(2);
    const withCode = await applyCartDiscount(token, "save10");
    expect(withCode.discountCodes).toEqual(["SAVE10"]);
    expect(withCode.discountTotal).toBe(500);

    const removed = await removeCartDiscount(token, "SAVE10");
    expect(removed.discountCodes).toEqual([]);
    expect(removed.discountTotal).toBe(0);
  });

  it("rejects invalid codes at apply time", async () => {
    const token = await cartWith(1);
    await expect(applyCartDiscount(token, "NOPE")).rejects.toThrow(/not valid/);
  });

  it("surfaces soured codes as discountError instead of breaking the cart", async () => {
    const token = await cartWith(2);
    await applyCartDiscount(token, "SAVE10");
    await db.update(discounts).set({ isActive: false }).where(eq(discounts.code, "SAVE10"));

    const view = await getCartByToken(token);
    expect(view.discountTotal).toBe(0);
    expect(view.discountError).toMatch(/not valid/);
  });
});

describe("checkout with discounts, shipping and tax", () => {
  it("requires a shipping rate when the store has shipping configured", async () => {
    const token = await cartWith(2);
    await expect(
      prepareCheckout({ cartToken: token, email: "b@x.com", shippingAddress }),
    ).rejects.toThrow(/Select a shipping rate/);
  });

  it("computes the full totals stack and snapshots codes + rate on the order", async () => {
    await updateTaxSettings({ mode: "flat", rateBps: 2000, pricesIncludeTax: false });
    const token = await cartWith(2);
    await applyCartDiscount(token, "SAVE10");

    const prep = await prepareCheckout({
      cartToken: token,
      email: "b@x.com",
      shippingAddress,
      shippingRateId: rateId,
    });

    // subtotal 5000, −10% = 4500 base, tax 20% = 900, shipping 599
    expect(prep.totals.subtotal).toBe(5000);
    expect(prep.totals.discountTotal).toBe(500);
    expect(prep.totals.shippingTotal).toBe(599);
    expect(prep.totals.taxTotal).toBe(900);
    expect(prep.totals.grandTotal).toBe(5999);
    expect(prep.order.discountCode).toBe("SAVE10");
    expect(prep.order.shippingRateName).toBe("Standard");
  });

  it("free_shipping code zeroes the selected rate", async () => {
    const token = await cartWith(2);
    await applyCartDiscount(token, "SHIPFREE");
    const prep = await prepareCheckout({
      cartToken: token,
      email: "b@x.com",
      shippingAddress,
      shippingRateId: rateId,
    });
    expect(prep.totals.shippingTotal).toBe(0);
    expect(prep.totals.grandTotal).toBe(5000);
  });

  it("rejects a rate that doesn't serve the destination", async () => {
    const token = await cartWith(1);
    await expect(
      prepareCheckout({
        cartToken: token,
        email: "b@x.com",
        shippingAddress: { ...shippingAddress, country: "JP" },
        shippingRateId: rateId,
      }),
    ).rejects.toThrow(/isn't available/);
  });

  it("records discount redemptions when the order is paid", async () => {
    const token = await cartWith(2);
    await applyCartDiscount(token, "SAVE10");
    const prep = await prepareCheckout({
      cartToken: token,
      email: "b@x.com",
      shippingAddress,
      shippingRateId: rateId,
    });
    await recordPaymentIntent(prep.order.id, "pi_1", prep.totals.grandTotal, "USD");
    await processStripeEvent({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1" } },
    });

    const redemptions = await db.select().from(discountRedemptions);
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]!.orderId).toBe(prep.order.id);
  });
});
