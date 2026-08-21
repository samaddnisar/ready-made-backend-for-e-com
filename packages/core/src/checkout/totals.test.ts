import { describe, expect, it } from "vitest";
import { computeTotals } from "./totals";

describe("computeTotals", () => {
  const items = [
    { unitPrice: 1999, quantity: 2 }, // 3998
    { unitPrice: 500, quantity: 1 }, // 500
  ];

  it("sums line totals into the subtotal", () => {
    const t = computeTotals({ items });
    expect(t.subtotal).toBe(4498);
    expect(t.grandTotal).toBe(4498);
    expect(t.taxTotal).toBe(0);
  });

  it("applies discount and shipping", () => {
    const t = computeTotals({ items, discountTotal: 1000, shippingTotal: 599 });
    expect(t.grandTotal).toBe(4498 - 1000 + 599);
  });

  it("clamps the discount at the subtotal (never negative goods total)", () => {
    const t = computeTotals({ items, discountTotal: 99_999 });
    expect(t.discountTotal).toBe(4498);
    expect(t.grandTotal).toBe(0);
  });

  it("ignores negative discount/shipping inputs", () => {
    const t = computeTotals({ items, discountTotal: -100, shippingTotal: -50 });
    expect(t.discountTotal).toBe(0);
    expect(t.shippingTotal).toBe(0);
  });

  it("computes exclusive flat tax on the discounted base", () => {
    // 20% on (4498 - 498) = 800
    const t = computeTotals({
      items,
      discountTotal: 498,
      tax: { mode: "flat", rateBps: 2000, pricesIncludeTax: false },
    });
    expect(t.taxTotal).toBe(800);
    expect(t.grandTotal).toBe(4000 + 800);
  });

  it("extracts inclusive flat tax without changing the total", () => {
    // 20% included in 4498 → tax portion = 4498 - 4498/1.2 ≈ 750
    const t = computeTotals({ items, tax: { mode: "flat", rateBps: 2000, pricesIncludeTax: true } });
    expect(t.taxTotal).toBe(750);
    expect(t.grandTotal).toBe(4498);
  });
});
