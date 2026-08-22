import { and, desc, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { orderItems, orders } from "../db/schema";
import { lowStockSummary } from "../inventory/service";

/** Orders that count as revenue (§7 dashboard): paid and kept. */
const REVENUE_STATUSES = sql`('paid','fulfilled','shipped','delivered','completed','partially_refunded')`;

export type DashboardRange = { from: Date; to: Date };

export type DashboardStats = {
  range: { from: string; to: string };
  revenue: number;
  orderCount: number;
  /** Average order value (minor units); 0 when no orders. */
  aov: number;
  /** Deltas vs the equally-long window immediately before `from` (null when the previous window had no data). */
  previous: { revenue: number; orderCount: number; aov: number };
  revenueByDay: { date: string; revenue: number; orders: number }[];
  topProducts: { productTitle: string; unitsSold: number; revenue: number }[];
  recentOrders: {
    id: string;
    orderNumber: string;
    email: string;
    status: string;
    grandTotal: number;
    currency: string;
    createdAt: Date;
  }[];
  lowStock: { low: number; out: number };
};

async function windowStats(from: Date, to: Date): Promise<{ revenue: number; orderCount: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${orders.grandTotal}), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.status}::text in ${REVENUE_STATUSES}`,
        gte(orders.createdAt, from),
        lte(orders.createdAt, to),
      ),
    );
  return { revenue: row?.revenue ?? 0, orderCount: row?.orderCount ?? 0 };
}

export async function getDashboardStats(range: DashboardRange): Promise<DashboardStats> {
  const db = getDb();
  const { from, to } = range;

  const windowMs = Math.max(to.getTime() - from.getTime(), 1);
  const prevFrom = new Date(from.getTime() - windowMs);
  const prevTo = new Date(from.getTime() - 1);

  const [current, previous] = await Promise.all([windowStats(from, to), windowStats(prevFrom, prevTo)]);

  const revenueByDay = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${orders.createdAt}), 'YYYY-MM-DD')`,
      revenue: sql<number>`coalesce(sum(${orders.grandTotal}), 0)::int`,
      orders: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.status}::text in ${REVENUE_STATUSES}`,
        gte(orders.createdAt, from),
        lte(orders.createdAt, to),
      ),
    )
    .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('day', ${orders.createdAt})`);

  const topProducts = await db
    .select({
      productTitle: orderItems.productTitle,
      unitsSold: sql<number>`sum(${orderItems.quantity})::int`,
      revenue: sql<number>`sum(${orderItems.unitPrice} * ${orderItems.quantity})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, sql`${orders.id} = ${orderItems.orderId}`)
    .where(
      and(
        sql`${orders.status}::text in ${REVENUE_STATUSES}`,
        gte(orders.createdAt, from),
        lte(orders.createdAt, to),
      ),
    )
    .groupBy(orderItems.productTitle)
    .orderBy(desc(sql`sum(${orderItems.unitPrice} * ${orderItems.quantity})`))
    .limit(10);

  const recentOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      email: orders.email,
      status: sql<string>`${orders.status}::text`,
      grandTotal: orders.grandTotal,
      currency: orders.currency,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(8);

  const lowStock = await lowStockSummary();

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    revenue: current.revenue,
    orderCount: current.orderCount,
    aov: current.orderCount > 0 ? Math.round(current.revenue / current.orderCount) : 0,
    previous: {
      revenue: previous.revenue,
      orderCount: previous.orderCount,
      aov: previous.orderCount > 0 ? Math.round(previous.revenue / previous.orderCount) : 0,
    },
    revenueByDay,
    topProducts,
    recentOrders,
    lowStock,
  };
}
