/**
 * Order totals math — money path, unit-tested (§9). All values integer
 * minor units. Phase 5 wires discounts, shipping rates and tax into the
 * options; the shape is fixed now so checkout doesn't change.
 */

export type TotalsLine = { unitPrice: number; quantity: number };

export type TotalsInput = {
  items: TotalsLine[];
  /** Minor units to subtract (already resolved from a discount). */
  discountTotal?: number;
  /** Minor units for the selected shipping rate. */
  shippingTotal?: number;
  /** Tax config: none | flat (rateBps, inclusive or on top). */
  tax?: { mode: "none" } | { mode: "flat"; rateBps: number; pricesIncludeTax: boolean };
};

export type Totals = {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
};

export function computeTotals(input: TotalsInput): Totals {
  const subtotal = input.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  // Discounts can never push the goods total below zero.
  const discountTotal = Math.min(Math.max(input.discountTotal ?? 0, 0), subtotal);
  const shippingTotal = Math.max(input.shippingTotal ?? 0, 0);
  const taxableBase = subtotal - discountTotal;

  let taxTotal = 0;
  if (input.tax && input.tax.mode === "flat" && input.tax.rateBps > 0) {
    taxTotal = input.tax.pricesIncludeTax
      ? // Inclusive: extract the tax portion contained in the base.
        Math.round(taxableBase - (taxableBase * 10_000) / (10_000 + input.tax.rateBps))
      : Math.round((taxableBase * input.tax.rateBps) / 10_000);
  }

  const grandTotal =
    input.tax && input.tax.mode === "flat" && input.tax.pricesIncludeTax
      ? taxableBase + shippingTotal // tax already inside the item prices
      : taxableBase + shippingTotal + taxTotal;

  return { subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}
