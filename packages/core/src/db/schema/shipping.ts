import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, shippingRateTypeEnum, taxModeEnum, timestamps } from "./_shared";

export const shippingZones = pgTable("shipping_zones", {
  id: id(),
  name: text("name").notNull(),
  /** ISO country codes; "*" entry = rest of world. */
  countries: jsonb("countries").$type<string[]>().notNull().default([]),
  ...timestamps(),
}).enableRLS();

export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: id(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: shippingRateTypeEnum("type").notNull().default("flat"),
    /** Minor units. */
    price: integer("price").notNull().default(0),
    /** Bounds for weight (grams) or cart subtotal (minor units), by type. */
    minCondition: integer("min_condition"),
    maxCondition: integer("max_condition"),
    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("shipping_rates_zone_id_idx").on(t.zoneId)],
).enableRLS();

/** Singleton — one row, enforced by the fixed primary key. */
export const taxSettings = pgTable("tax_settings", {
  id: integer("id").primaryKey().default(1),
  mode: taxModeEnum("mode").notNull().default("none"),
  /** Basis points (e.g. 2000 = 20%) — used when mode = "flat". */
  rateBps: integer("rate_bps").notNull().default(0),
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
  ...timestamps(),
}).enableRLS();
