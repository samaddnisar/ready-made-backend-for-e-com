import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { shippingRates, shippingZones, taxSettings } from "../db/schema";
import { notFound } from "../errors";
import type {
  CreateShippingRateInput,
  CreateShippingZoneInput,
  UpdateShippingRateInput,
  UpdateShippingZoneInput,
  UpdateTaxSettingsInput,
} from "../validation/shipping";

export type ShippingZone = typeof shippingZones.$inferSelect;
export type ShippingRate = typeof shippingRates.$inferSelect;

// ── Zones ────────────────────────────────────────────────────

export type ZoneWithRates = ShippingZone & { rates: ShippingRate[] };

export async function listShippingZones(): Promise<ZoneWithRates[]> {
  const db = getDb();
  const zones = await db.select().from(shippingZones).orderBy(asc(shippingZones.createdAt));
  const rates = await db.select().from(shippingRates).orderBy(asc(shippingRates.position), asc(shippingRates.price));
  return zones.map((z) => ({ ...z, rates: rates.filter((r) => r.zoneId === z.id) }));
}

export async function createShippingZone(input: CreateShippingZoneInput): Promise<ShippingZone> {
  const db = getDb();
  const [row] = await db
    .insert(shippingZones)
    .values({ name: input.name, countries: input.countries })
    .returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateShippingZone(
  id: string,
  input: UpdateShippingZoneInput,
): Promise<ShippingZone> {
  const db = getDb();
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [row] = await db
    .update(shippingZones)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(shippingZones.id, id))
    .returning();
  if (!row) throw notFound("Shipping zone not found");
  return row;
}

export async function deleteShippingZone(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .delete(shippingZones)
    .where(eq(shippingZones.id, id))
    .returning({ id: shippingZones.id });
  if (!row) throw notFound("Shipping zone not found");
}

// ── Rates ────────────────────────────────────────────────────

export async function createShippingRate(
  zoneId: string,
  input: CreateShippingRateInput,
): Promise<ShippingRate> {
  const db = getDb();
  const zone = await db.query.shippingZones.findFirst({ where: eq(shippingZones.id, zoneId) });
  if (!zone) throw notFound("Shipping zone not found");
  const [row] = await db
    .insert(shippingRates)
    .values({ ...input, zoneId })
    .returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateShippingRate(
  id: string,
  input: UpdateShippingRateInput,
): Promise<ShippingRate> {
  const db = getDb();
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [row] = await db
    .update(shippingRates)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(shippingRates.id, id))
    .returning();
  if (!row) throw notFound("Shipping rate not found");
  return row;
}

export async function deleteShippingRate(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .delete(shippingRates)
    .where(eq(shippingRates.id, id))
    .returning({ id: shippingRates.id });
  if (!row) throw notFound("Shipping rate not found");
}

// ── Resolution (checkout) ────────────────────────────────────

export type ResolvedRate = {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  type: ShippingRate["type"];
  price: number;
};

/**
 * Rates available for a destination + cart. Zone matching: zones listing the
 * exact country win; the "*" (rest of world) zones apply only when no exact
 * zone matches. Conditions: weight rates bound on total grams, price rates
 * bound on the goods subtotal (minor units); null bounds are open.
 */
export async function resolveShippingRates(
  country: string,
  cart: { subtotal: number; weightGrams: number },
): Promise<ResolvedRate[]> {
  const db = getDb();
  const upper = country.toUpperCase();
  const zones = await db.select().from(shippingZones);

  const exact = zones.filter((z) => z.countries.includes(upper));
  const fallback = zones.filter((z) => z.countries.includes("*"));
  const applicable = exact.length > 0 ? exact : fallback;
  if (applicable.length === 0) return [];

  const rates = await db
    .select()
    .from(shippingRates)
    .where(
      and(
        inArray(
          shippingRates.zoneId,
          applicable.map((z) => z.id),
        ),
        eq(shippingRates.isActive, true),
      ),
    )
    .orderBy(asc(shippingRates.position), asc(shippingRates.price));

  const zoneName = new Map(applicable.map((z) => [z.id, z.name]));
  return rates
    .filter((r) => {
      const metric =
        r.type === "weight" ? cart.weightGrams : r.type === "price" ? cart.subtotal : null;
      if (metric === null) return true;
      if (r.minCondition !== null && metric < r.minCondition) return false;
      if (r.maxCondition !== null && metric > r.maxCondition) return false;
      return true;
    })
    .map((r) => ({
      id: r.id,
      zoneId: r.zoneId,
      zoneName: zoneName.get(r.zoneId) ?? "",
      name: r.name,
      type: r.type,
      price: r.price,
    }));
}

/** Whether the store has ANY shipping zones set up (checkout uses this to
 *  distinguish "shipping not configured" from "we can't ship there"). */
export async function hasShippingConfigured(): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select({ n: sql`count(*)::int` }).from(shippingZones);
  return Number(row?.n ?? 0) > 0;
}

// ── Tax settings ─────────────────────────────────────────────

export type TaxSettings = typeof taxSettings.$inferSelect;

export async function getTaxSettings(): Promise<TaxSettings> {
  const db = getDb();
  let row = await db.query.taxSettings.findFirst({ where: eq(taxSettings.id, 1) });
  if (!row) {
    const [inserted] = await db.insert(taxSettings).values({ id: 1 }).onConflictDoNothing().returning();
    row = inserted ?? (await db.query.taxSettings.findFirst({ where: eq(taxSettings.id, 1) }));
  }
  if (!row) throw new Error("Failed to load tax settings");
  return row;
}

export async function updateTaxSettings(input: UpdateTaxSettingsInput): Promise<TaxSettings> {
  const db = getDb();
  await getTaxSettings(); // ensure the row exists
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [row] = await db
    .update(taxSettings)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(taxSettings.id, 1))
    .returning();
  if (!row) throw new Error("Tax settings update failed");
  return row;
}
