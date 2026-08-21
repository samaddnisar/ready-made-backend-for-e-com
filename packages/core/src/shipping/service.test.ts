import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { shippingRates, shippingZones, taxSettings } from "../db/schema";
import { getTaxSettings, resolveShippingRates, updateTaxSettings } from "./service";

let db: Db;

async function mkZone(name: string, countries: string[]) {
  const [zone] = await db.insert(shippingZones).values({ name, countries }).returning();
  return zone!;
}

async function mkRate(zoneId: string, overrides: Partial<typeof shippingRates.$inferInsert> = {}) {
  const [rate] = await db
    .insert(shippingRates)
    .values({ zoneId, name: "Standard", type: "flat", price: 500, ...overrides })
    .returning();
  return rate!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(shippingRates);
  await db.delete(shippingZones);
  await db.delete(taxSettings);
});

describe("resolveShippingRates", () => {
  it("matches the destination country's zone", async () => {
    const us = await mkZone("US", ["US"]);
    const eu = await mkZone("EU", ["DE", "FR"]);
    await mkRate(us.id, { name: "US Standard", price: 500 });
    await mkRate(eu.id, { name: "EU Standard", price: 900 });

    const rates = await resolveShippingRates("us", { subtotal: 1000, weightGrams: 100 });
    expect(rates).toHaveLength(1);
    expect(rates[0]!.name).toBe("US Standard");
  });

  it("falls back to rest-of-world zones only when no exact match exists", async () => {
    const us = await mkZone("US", ["US"]);
    const row = await mkZone("Rest of world", ["*"]);
    await mkRate(us.id, { name: "US Standard" });
    await mkRate(row.id, { name: "Intl", price: 1500 });

    const intl = await resolveShippingRates("JP", { subtotal: 1000, weightGrams: 100 });
    expect(intl.map((r) => r.name)).toEqual(["Intl"]);

    const domestic = await resolveShippingRates("US", { subtotal: 1000, weightGrams: 100 });
    expect(domestic.map((r) => r.name)).toEqual(["US Standard"]); // no ROW leakage
  });

  it("applies weight and price conditions with open null bounds", async () => {
    const zone = await mkZone("US", ["US"]);
    await mkRate(zone.id, { name: "Light", type: "weight", minCondition: null, maxCondition: 1000, price: 400 });
    await mkRate(zone.id, { name: "Heavy", type: "weight", minCondition: 1001, maxCondition: null, price: 1200 });
    await mkRate(zone.id, { name: "Free over $50", type: "price", minCondition: 5000, maxCondition: null, price: 0 });

    const light = await resolveShippingRates("US", { subtotal: 2000, weightGrams: 500 });
    expect(light.map((r) => r.name)).toEqual(["Light"]);

    const heavy = await resolveShippingRates("US", { subtotal: 9000, weightGrams: 3000 });
    expect(heavy.map((r) => r.name).sort()).toEqual(["Free over $50", "Heavy"]);
  });

  it("excludes inactive rates and returns empty when no zone covers the country", async () => {
    const zone = await mkZone("US", ["US"]);
    await mkRate(zone.id, { isActive: false });
    expect(await resolveShippingRates("US", { subtotal: 100, weightGrams: 10 })).toEqual([]);
    expect(await resolveShippingRates("BR", { subtotal: 100, weightGrams: 10 })).toEqual([]);
  });
});

describe("tax settings", () => {
  it("bootstraps the singleton with mode none and updates it", async () => {
    const initial = await getTaxSettings();
    expect(initial.mode).toBe("none");

    const updated = await updateTaxSettings({ mode: "flat", rateBps: 2000, pricesIncludeTax: false });
    expect(updated.mode).toBe("flat");
    expect(updated.rateBps).toBe(2000);
    expect((await getTaxSettings()).rateBps).toBe(2000);
  });
});
