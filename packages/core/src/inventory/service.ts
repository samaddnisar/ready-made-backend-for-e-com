import { and, asc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import {
  inventory,
  inventoryAdjustments,
  inventoryReservations,
  products,
  productVariants,
} from "../db/schema";
import { AppError, badRequest, notFound } from "../errors";
import { paginate, type Paginated } from "../validation/common";
import type {
  AdjustStockInput,
  ListInventoryQuery,
  UpdateInventoryConfigInput,
} from "../validation/inventory";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// ── Admin: list + adjust + config ────────────────────────────

export type InventoryRow = {
  inventoryId: string;
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  reservedQty: number;
  available: number;
  lowStockThreshold: number | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  updatedAt: Date;
};

const lowStockFilter = sql`${inventory.trackInventory} and ${inventory.lowStockThreshold} is not null and (${inventory.quantity} - ${inventory.reservedQty}) <= ${inventory.lowStockThreshold}`;

export async function listInventory(query: ListInventoryQuery): Promise<Paginated<InventoryRow>> {
  const db = getDb();
  const filters: SQL[] = [isNull(products.deletedAt), isNull(productVariants.deletedAt)];
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(products.title, term),
        ilike(productVariants.sku, term),
        ilike(productVariants.title, term),
      )!,
    );
  }
  if (query.lowStockOnly) filters.push(lowStockFilter);

  const where = and(...filters);
  const base = db
    .select({
      inventoryId: inventory.id,
      variantId: inventory.variantId,
      productId: products.id,
      productTitle: products.title,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      quantity: inventory.quantity,
      reservedQty: inventory.reservedQty,
      available: sql<number>`(${inventory.quantity} - ${inventory.reservedQty})::int`,
      lowStockThreshold: inventory.lowStockThreshold,
      trackInventory: inventory.trackInventory,
      allowBackorder: inventory.allowBackorder,
      updatedAt: inventory.updatedAt,
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId));

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(where);

  const rows = await base
    .where(where)
    .orderBy(asc(products.title), asc(productVariants.position))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

/** Low-stock + out-of-stock counts for dashboard alerts. */
export async function lowStockSummary(): Promise<{ low: number; out: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      low: sql<number>`count(*) filter (where ${lowStockFilter})::int`,
      out: sql<number>`count(*) filter (where ${inventory.trackInventory} and (${inventory.quantity} - ${inventory.reservedQty}) <= 0)::int`,
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(isNull(products.deletedAt), isNull(productVariants.deletedAt)));
  return { low: row?.low ?? 0, out: row?.out ?? 0 };
}

/**
 * Manual stock adjustment with a reason (§7). Row-locked so concurrent
 * adjustments/reservations can't interleave; never lets on-hand go negative.
 */
export async function adjustStock(
  input: AdjustStockInput,
  adminUserId: string,
): Promise<{ quantity: number }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: inventory.id, quantity: inventory.quantity })
      .from(inventory)
      .where(eq(inventory.variantId, input.variantId))
      .for("update");
    if (!row) throw notFound("Inventory record not found");

    const next = row.quantity + input.delta;
    if (next < 0) {
      throw badRequest(`Adjustment would make stock negative (current ${row.quantity})`);
    }

    await tx
      .update(inventory)
      .set({ quantity: next, updatedAt: new Date() })
      .where(eq(inventory.id, row.id));
    await tx.insert(inventoryAdjustments).values({
      variantId: input.variantId,
      delta: input.delta,
      reason: input.reason,
      adminUserId,
    });
    return { quantity: next };
  });
}

export async function updateInventoryConfig(
  variantId: string,
  input: UpdateInventoryConfigInput,
): Promise<void> {
  const db = getDb();
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length === 0) return;
  const [row] = await db
    .update(inventory)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(inventory.variantId, variantId))
    .returning({ id: inventory.id });
  if (!row) throw notFound("Inventory record not found");
}

export async function listAdjustments(variantId: string, limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(inventoryAdjustments)
    .where(eq(inventoryAdjustments.variantId, variantId))
    .orderBy(sql`${inventoryAdjustments.createdAt} desc`)
    .limit(limit);
}

// ── Availability (public product pages + checkout) ───────────

export type VariantAvailability = {
  variantId: string;
  tracked: boolean;
  available: number;
  allowBackorder: boolean;
  /** true when purchasable right now (untracked, backorderable, or available > 0). */
  inStock: boolean;
};

export async function getAvailability(variantIds: string[]): Promise<Map<string, VariantAvailability>> {
  const map = new Map<string, VariantAvailability>();
  if (variantIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({
      variantId: inventory.variantId,
      tracked: inventory.trackInventory,
      available: sql<number>`(${inventory.quantity} - ${inventory.reservedQty})::int`,
      allowBackorder: inventory.allowBackorder,
    })
    .from(inventory)
    .where(inArray(inventory.variantId, variantIds));

  for (const id of variantIds) {
    const row = rows.find((r) => r.variantId === id);
    if (!row) {
      // No inventory record = untracked = always purchasable.
      map.set(id, { variantId: id, tracked: false, available: 0, allowBackorder: false, inStock: true });
    } else {
      map.set(id, {
        variantId: id,
        tracked: row.tracked,
        available: row.available,
        allowBackorder: row.allowBackorder,
        inStock: !row.tracked || row.allowBackorder || row.available > 0,
      });
    }
  }
  return map;
}

// ── Reservations (§5: reserve at checkout start, release on failure/expiry) ──

export const RESERVATION_TTL_MINUTES = 30;

/**
 * Reserve stock for a cart's items at checkout start. Race-safe: rows are
 * locked FOR UPDATE in a stable order (variantId) so two concurrent
 * checkouts can't both take the last unit, and can't deadlock.
 * Existing active reservations for the cart are released first (re-checkout).
 * Throws AppError("out_of_stock") listing the offending variants.
 */
export async function reserveStock(
  cartId: string,
  items: { variantId: string; quantity: number }[],
  ttlMinutes = RESERVATION_TTL_MINUTES,
): Promise<{ expiresAt: Date }> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));

  await db.transaction(async (tx) => {
    await releaseCartReservationsTx(tx, cartId);

    const outOfStock: { variantId: string; requested: number; available: number }[] = [];
    for (const item of sorted) {
      if (item.quantity <= 0) continue;
      const [row] = await tx
        .select({
          id: inventory.id,
          quantity: inventory.quantity,
          reservedQty: inventory.reservedQty,
          trackInventory: inventory.trackInventory,
          allowBackorder: inventory.allowBackorder,
        })
        .from(inventory)
        .where(eq(inventory.variantId, item.variantId))
        .for("update");

      // Untracked (or no record): nothing to hold.
      if (!row || !row.trackInventory) continue;

      const available = row.quantity - row.reservedQty;
      if (available < item.quantity && !row.allowBackorder) {
        outOfStock.push({ variantId: item.variantId, requested: item.quantity, available });
        continue;
      }

      await tx
        .update(inventory)
        .set({ reservedQty: row.reservedQty + item.quantity, updatedAt: new Date() })
        .where(eq(inventory.id, row.id));
      await tx.insert(inventoryReservations).values({
        variantId: item.variantId,
        cartId,
        quantity: item.quantity,
        expiresAt,
      });
    }

    if (outOfStock.length > 0) {
      // Transaction rolls back — nothing stays reserved.
      throw new AppError("out_of_stock", "Some items are no longer available", outOfStock);
    }
  });

  return { expiresAt };
}

async function releaseCartReservationsTx(tx: Tx, cartId: string): Promise<void> {
  const active = await tx
    .select()
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.cartId, cartId),
        isNull(inventoryReservations.releasedAt),
        isNull(inventoryReservations.consumedAt),
      ),
    )
    .for("update");

  for (const r of active) {
    await tx
      .update(inventory)
      .set({
        reservedQty: sql`greatest(0, ${inventory.reservedQty} - ${r.quantity})`,
        updatedAt: new Date(),
      })
      .where(eq(inventory.variantId, r.variantId));
    await tx
      .update(inventoryReservations)
      .set({ releasedAt: new Date() })
      .where(eq(inventoryReservations.id, r.id));
  }
}

/** Release a cart's holds (payment failed, cart abandoned, checkout restarted). */
export async function releaseCartReservations(cartId: string, txIn?: Tx): Promise<void> {
  if (txIn) return releaseCartReservationsTx(txIn, cartId);
  const db = getDb();
  await db.transaction(async (tx) => releaseCartReservationsTx(tx, cartId));
}

/**
 * Convert a cart's holds into a real stock decrement (order paid).
 * Quantity and reserved both drop; the reservation is marked consumed.
 * Reservation-only semantics (idempotent — consumed holds are skipped).
 */
export async function consumeCartReservations(
  cartId: string,
  orderId: string,
  txIn?: Tx,
): Promise<Map<string, number>> {
  const run = async (tx: Tx): Promise<Map<string, number>> => {
    const consumed = new Map<string, number>();
    const active = await tx
      .select()
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.cartId, cartId),
          isNull(inventoryReservations.releasedAt),
          isNull(inventoryReservations.consumedAt),
        ),
      )
      .for("update");

    for (const r of active) {
      await tx
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} - ${r.quantity}`,
          reservedQty: sql`greatest(0, ${inventory.reservedQty} - ${r.quantity})`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.variantId, r.variantId));
      await tx
        .update(inventoryReservations)
        .set({ consumedAt: new Date(), orderId })
        .where(eq(inventoryReservations.id, r.id));
      consumed.set(r.variantId, (consumed.get(r.variantId) ?? 0) + r.quantity);
    }
    return consumed;
  };
  if (txIn) return run(txIn);
  const db = getDb();
  return db.transaction(run);
}

/**
 * Paid-order stock consumption with an expired-holds fallback: consume any
 * active reservations, then decrement remaining order-item quantities
 * directly (the 30-min hold may have been swept before payment landed —
 * the customer still paid, so stock must drop; clamped at zero with an
 * oversell alert). NOT idempotent — call exactly once, inside the
 * pending→paid transition's transaction.
 */
export async function consumeOrderStock(
  orderId: string,
  cartId: string | null,
  items: { variantId: string | null; quantity: number }[],
  txIn?: Tx,
): Promise<void> {
  const run = async (tx: Tx): Promise<void> => {
    const consumed = cartId
      ? await consumeCartReservations(cartId, orderId, tx)
      : new Map<string, number>();

    for (const item of items) {
      if (!item.variantId) continue;
      const shortfall = item.quantity - (consumed.get(item.variantId) ?? 0);
      if (shortfall <= 0) continue;

      const [inv] = await tx
        .select()
        .from(inventory)
        .where(eq(inventory.variantId, item.variantId))
        .for("update");
      if (!inv || !inv.trackInventory) continue;

      if (inv.quantity < shortfall) {
        console.error(
          `[inventory] oversell on paid order ${orderId}: variant ${item.variantId} needs ${shortfall}, on hand ${inv.quantity}`,
        );
      }
      await tx
        .update(inventory)
        .set({ quantity: Math.max(0, inv.quantity - shortfall), updatedAt: new Date() })
        .where(eq(inventory.id, inv.id));
    }
  };
  if (txIn) return run(txIn);
  const db = getDb();
  return db.transaction(run);
}

/**
 * Sweep expired holds back into available stock. Called opportunistically
 * (checkout start) and from background jobs — idempotent and batch-safe.
 */
export async function releaseExpiredReservations(limit = 200): Promise<number> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const expired = await tx
      .select()
      .from(inventoryReservations)
      .where(
        and(
          lt(inventoryReservations.expiresAt, new Date()),
          isNull(inventoryReservations.releasedAt),
          isNull(inventoryReservations.consumedAt),
        ),
      )
      .limit(limit)
      .for("update", { skipLocked: true });

    for (const r of expired) {
      await tx
        .update(inventory)
        .set({
          reservedQty: sql`greatest(0, ${inventory.reservedQty} - ${r.quantity})`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.variantId, r.variantId));
      await tx
        .update(inventoryReservations)
        .set({ releasedAt: new Date() })
        .where(eq(inventoryReservations.id, r.id));
    }
    return expired.length;
  });
}
