import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { orderItems, orders, orderStatusHistory, payments, refunds } from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { paginate, type Paginated } from "../validation/common";
import type { ListOrdersQuery, UpdateOrderStatusInput } from "../validation/orders";
import {
  ADMIN_MANUAL_TRANSITIONS,
  transitionOrder,
  type OrderStatus,
} from "./state-machine";

export type OrderListItem = {
  id: string;
  orderNumber: string;
  email: string;
  status: OrderStatus;
  grandTotal: number;
  currency: string;
  itemCount: number;
  createdAt: Date;
};

export async function listOrders(query: ListOrdersQuery): Promise<Paginated<OrderListItem>> {
  const db = getDb();
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(orders.status, query.status));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(orders.orderNumber, term), ilike(orders.email, term))!);
  }
  if (query.from) filters.push(gte(orders.createdAt, new Date(query.from)));
  if (query.to) filters.push(lte(orders.createdAt, new Date(query.to)));

  const where = filters.length ? and(...filters) : undefined;
  const direction = query.order === "asc" ? asc : desc;
  const orderBy =
    query.sort === "grandTotal" ? direction(orders.grandTotal) : direction(orders.createdAt);

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where);
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      email: orders.email,
      status: orders.status,
      grandTotal: orders.grandTotal,
      currency: orders.currency,
      itemCount: sql<number>`(select coalesce(sum(oi.quantity), 0)::int from order_items oi where oi.order_id = orders.id)`,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(where)
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

export type OrderDetail = typeof orders.$inferSelect & {
  items: (typeof orderItems.$inferSelect)[];
  statusHistory: (typeof orderStatusHistory.$inferSelect)[];
  payments: (typeof payments.$inferSelect & { refunds: (typeof refunds.$inferSelect)[] })[];
  refundedTotal: number;
  refundableTotal: number;
};

export async function getOrderDetail(id: string): Promise<OrderDetail> {
  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      items: true,
      statusHistory: { orderBy: desc(orderStatusHistory.createdAt) },
      payments: { with: { refunds: true } },
    },
  });
  if (!order) throw notFound("Order not found");

  const { refundedTotal, refundableTotal } = computeRefundState(order.payments);
  return { ...order, refundedTotal, refundableTotal };
}

function computeRefundState(
  paymentRows: (typeof payments.$inferSelect & { refunds: (typeof refunds.$inferSelect)[] })[],
): { refundedTotal: number; refundableTotal: number } {
  const paid = paymentRows
    .filter((p) => p.status === "succeeded")
    .reduce((sum, p) => sum + p.amount, 0);
  // Pending refunds count against refundable so double-submits can't overshoot.
  const refunded = paymentRows
    .flatMap((p) => p.refunds)
    .filter((r) => r.status === "succeeded" || r.status === "pending")
    .reduce((sum, r) => sum + r.amount, 0);
  return { refundedTotal: refunded, refundableTotal: Math.max(0, paid - refunded) };
}

/** Manual admin transition (webhooks own paid/payment_failed; refunds own refund states). */
export async function adminTransitionOrder(
  orderId: string,
  input: UpdateOrderStatusInput,
  adminUserId: string,
): Promise<{ order: typeof orders.$inferSelect; email: "order_shipped" | null }> {
  if (!ADMIN_MANUAL_TRANSITIONS.includes(input.status)) {
    throw badRequest("This status can't be set manually");
  }
  const result = await transitionOrder(orderId, input.status, adminUserId, input.note);
  return {
    order: result.order,
    email: input.status === "shipped" && result.fromStatus !== "shipped" ? "order_shipped" : null,
  };
}

export async function updateOrderNotes(orderId: string, notes: string | null): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(orders)
    .set({ notes, updatedAt: new Date() })
    .where(eq(orders.id, orderId))
    .returning({ id: orders.id });
  if (!row) throw notFound("Order not found");
}

// ── Refunds (money path — §9) ────────────────────────────────

export type RefundContext = {
  order: typeof orders.$inferSelect;
  /** The succeeded payment to refund against. */
  payment: typeof payments.$inferSelect;
  refundedTotal: number;
  refundableTotal: number;
};

export async function getRefundContext(orderId: string): Promise<RefundContext> {
  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with: { payments: { with: { refunds: true } } },
  });
  if (!order) throw notFound("Order not found");

  const payment = order.payments.find((p) => p.status === "succeeded");
  if (!payment) throw badRequest("Order has no successful payment to refund");

  const { refundedTotal, refundableTotal } = computeRefundState(order.payments);
  return { order, payment, refundedTotal, refundableTotal };
}

/**
 * Race-safe refund start: locks the order row, recomputes the refundable
 * amount under the lock (pending refunds count against it), and inserts the
 * local refunds row BEFORE any money moves — the row is the reservation.
 * The route then executes the Stripe refund (with an idempotency key
 * derived from this row's id) and calls finalizeRefund with the result, so
 * every executed Stripe refund always has a local record.
 */
export async function beginRefund(
  orderId: string,
  input: { amount: number; reason?: string },
  adminUserId: string,
): Promise<{ refund: typeof refunds.$inferSelect; payment: typeof payments.$inferSelect }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw notFound("Order not found");

    const paymentRows = await tx.select().from(payments).where(eq(payments.orderId, orderId));
    const payment = paymentRows.find((p) => p.status === "succeeded");
    if (!payment) throw badRequest("Order has no successful payment to refund");

    const refundRows = paymentRows.length
      ? await tx
          .select()
          .from(refunds)
          .where(
            inArray(
              refunds.paymentId,
              paymentRows.map((p) => p.id),
            ),
          )
      : [];
    const paid = paymentRows
      .filter((p) => p.status === "succeeded")
      .reduce((sum, p) => sum + p.amount, 0);
    const held = refundRows
      .filter((r) => r.status === "succeeded" || r.status === "pending")
      .reduce((sum, r) => sum + r.amount, 0);
    const refundable = Math.max(0, paid - held);
    if (input.amount > refundable) {
      throw badRequest(`Refund of ${input.amount} exceeds the refundable amount (${refundable})`);
    }

    const [refund] = await tx
      .insert(refunds)
      .values({
        paymentId: payment.id,
        amount: input.amount,
        reason: input.reason ?? null,
        stripeRefundId: null,
        status: "pending",
        adminUserId,
      })
      .returning();
    if (!refund) throw new Error("Refund insert failed");
    return { refund, payment };
  });
}

/** Attach the Stripe result to a beginRefund row and sync the order status. */
export async function finalizeRefund(
  refundId: string,
  result: { stripeRefundId?: string; status: "pending" | "succeeded" | "failed" | "cancelled" },
  actor: string,
): Promise<typeof refunds.$inferSelect> {
  const db = getDb();
  const [row] = await db
    .update(refunds)
    .set({
      ...(result.stripeRefundId ? { stripeRefundId: result.stripeRefundId } : {}),
      status: result.status,
      updatedAt: new Date(),
    })
    .where(eq(refunds.id, refundId))
    .returning();
  if (!row) throw notFound("Refund not found");

  const payment = await db.query.payments.findFirst({ where: eq(payments.id, row.paymentId) });
  if (payment) await syncOrderRefundStatus(payment.orderId, actor);
  return row;
}

/** PaymentIntents on this order that are still cancellable at Stripe. */
export async function getCancellablePaymentIntents(orderId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: payments.stripePaymentIntentId, status: payments.status })
    .from(payments)
    .where(eq(payments.orderId, orderId));
  return rows
    .filter((p) => p.status === "pending" || p.status === "processing")
    .map((p) => p.id);
}

/**
 * Record a refund the route has already executed with Stripe, then bring
 * the order's status in line (partially_refunded / refunded).
 */
export async function recordRefund(
  paymentId: string,
  input: {
    amount: number;
    reason?: string;
    stripeRefundId: string;
    status: "pending" | "succeeded" | "failed" | "cancelled";
  },
  adminUserId: string,
): Promise<typeof refunds.$inferSelect> {
  const db = getDb();
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment) throw notFound("Payment not found");

  // Defense in depth: never book more than remains refundable on this order.
  const { refundableTotal } = await getRefundContext(payment.orderId);
  if (input.status !== "failed" && input.amount > refundableTotal) {
    throw badRequest(
      `Refund of ${input.amount} exceeds the refundable amount (${refundableTotal})`,
    );
  }

  const [row] = await db
    .insert(refunds)
    .values({
      paymentId,
      amount: input.amount,
      reason: input.reason ?? null,
      stripeRefundId: input.stripeRefundId,
      status: input.status,
      adminUserId,
    })
    .returning();
  if (!row) throw new Error("Refund insert failed");

  await syncOrderRefundStatus(payment.orderId, adminUserId);
  return row;
}

/** Recompute the order's refund status from its succeeded refunds. */
export async function syncOrderRefundStatus(orderId: string, actor: string): Promise<void> {
  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with: { payments: { with: { refunds: true } } },
  });
  if (!order) return;

  const succeeded = order.payments
    .flatMap((p) => p.refunds)
    .filter((r) => r.status === "succeeded")
    .reduce((sum, r) => sum + r.amount, 0);
  if (succeeded <= 0) return;

  const target: OrderStatus = succeeded >= order.grandTotal ? "refunded" : "partially_refunded";
  if (order.status === target) return;
  try {
    await transitionOrder(orderId, target, actor, `Refunded ${succeeded} of ${order.grandTotal}`);
  } catch (err) {
    // Illegal from a pre-payment state — surface, don't swallow silently.
    if (err instanceof Error && err.message.includes("Can't move order")) throw conflict(err.message);
    throw err;
  }
}

/** Guard against unfulfillable bulk ops elsewhere; kept for admin tooling. */
export async function getOrdersByIds(ids: string[]) {
  const db = getDb();
  if (ids.length === 0) return [];
  return db.select().from(orders).where(inArray(orders.id, ids));
}
