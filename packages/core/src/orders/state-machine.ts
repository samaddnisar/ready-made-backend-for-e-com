import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { orders, orderStatusHistory } from "../db/schema";
import { conflict, notFound } from "../errors";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type OrderStatus = (typeof orders.$inferSelect)["status"];

/**
 * §6 — the single source of truth for order status flow:
 *
 *   pending → paid → fulfilled → shipped → delivered → completed
 *      │        │
 *      │        └──→ partially_refunded / refunded (from any post-payment state)
 *      └──→ cancelled / payment_failed
 *
 * No ad-hoc status writes anywhere else — every change goes through
 * transitionOrder(), which enforces this map and records history.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled", "payment_failed"],
  paid: ["fulfilled", "partially_refunded", "refunded"],
  fulfilled: ["shipped", "partially_refunded", "refunded"],
  shipped: ["delivered", "partially_refunded", "refunded"],
  delivered: ["completed", "partially_refunded", "refunded"],
  completed: ["partially_refunded", "refunded"],
  // Partial refunds must not block the fulfillment flow.
  partially_refunded: ["refunded", "fulfilled", "shipped", "delivered", "completed"],
  refunded: [],
  cancelled: [],
  // A failed payment may be retried (back to pending) or abandoned.
  payment_failed: ["pending", "cancelled"],
};

/** Transitions an admin may trigger manually (webhooks own paid/payment_failed; refunds own refund states). */
export const ADMIN_MANUAL_TRANSITIONS: OrderStatus[] = [
  "fulfilled",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export type TransitionResult = {
  order: typeof orders.$inferSelect;
  fromStatus: OrderStatus;
};

/**
 * Atomically transition an order, enforcing the map and writing history.
 * Row-locked so concurrent transitions serialize. `actor` is "system",
 * "webhook:stripe", or an admin user id.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: string,
  note?: string,
  txIn?: Tx,
): Promise<TransitionResult> {
  const run = async (tx: Tx): Promise<TransitionResult> => {
    const [current] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!current) throw notFound("Order not found");

    if (current.status === to) {
      // Idempotent no-op (e.g. duplicate webhook) — no history spam.
      return { order: current, fromStatus: current.status };
    }
    if (!canTransition(current.status, to)) {
      throw conflict(`Can't move order from "${current.status}" to "${to}"`);
    }

    const [updated] = await tx
      .update(orders)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, current.status)))
      .returning();
    if (!updated) throw conflict("Order status changed concurrently — retry");

    await tx.insert(orderStatusHistory).values({
      orderId,
      fromStatus: current.status,
      toStatus: to,
      actor,
      note,
    });

    return { order: updated, fromStatus: current.status };
  };

  if (txIn) return run(txIn);
  const db = getDb();
  return db.transaction(run);
}
