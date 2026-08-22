"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { DashboardStats, OrderStatus } from "@repo/core";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/client-api";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "../orders/orders-table";
import { RevenueChart, type RevenueDay } from "./revenue-chart";

/** Wire shape: dates arrive as ISO strings over JSON. */
type DashboardData = Omit<DashboardStats, "recentOrders"> & {
  recentOrders: (Omit<DashboardStats["recentOrders"][number], "createdAt"> & {
    createdAt: string;
  })[];
};

type RangePreset = "7" | "30" | "90" | "custom";

const PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
];

/** "YYYY-MM-DD" from a date input → ISO datetime (start or end of local day). */
function toIsoBoundary(value: string, boundary: "start" | "end"): string | null {
  const date = new Date(boundary === "start" ? `${value}T00:00:00` : `${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Local date → "YYYY-MM-DD" for `<input type="date">`. */
function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Fill the missing days of the range with zero rows so the chart shows gaps
 * honestly. Bails out to the raw rows for pathological ranges (> 1 year) or if
 * the server's day keys don't line up with UTC days.
 */
function fillDays(range: { from: string; to: string }, rows: RevenueDay[]): RevenueDay[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return rows;

  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const lastDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const days: RevenueDay[] = [];
  while (cursor.getTime() <= lastDay) {
    if (days.length >= 366) return rows;
    const key = cursor.toISOString().slice(0, 10);
    days.push(byDate.get(key) ?? { date: key, revenue: 0, orders: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const filledKeys = new Set(days.map((day) => day.date));
  if (rows.some((row) => !filledKeys.has(row.date))) return rows;
  return days;
}

function orderStatusLabel(status: string): string {
  return status in ORDER_STATUS_LABEL ? ORDER_STATUS_LABEL[status as OrderStatus] : status;
}

function orderStatusVariant(status: string) {
  return status in ORDER_STATUS_BADGE ? ORDER_STATUS_BADGE[status as OrderStatus] : "outline";
}

/** % change vs the previous window, with a green-up / red-down arrow. Hidden when the previous window is 0. */
function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  return (
    <span
      title="vs previous period"
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
        up ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-500",
      )}
    >
      {up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {Math.abs(pct).toFixed(0)}%
      <span className="sr-only">{up ? "up" : "down"} vs previous period</span>
    </span>
  );
}

function StatCard({
  label,
  value,
  delta,
  subText,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  subText?: string;
}) {
  return (
    <Card className="h-full gap-1">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {delta}
        </div>
        {subText ? <p className="mt-0.5 text-xs text-muted-foreground">{subText}</p> : null}
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card className="h-full gap-1">
      <CardHeader>
        <Skeleton className="h-4 w-20" />
      </CardHeader>
      <CardContent className="space-y-1.5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-16" />
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-56 w-full" />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-9 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DashboardClient({ currency }: { currency: string }) {
  const [preset, setPreset] = useState<RangePreset>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [stats, setStats] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let fromIso: string | null;
    let toIso: string | null;
    if (preset === "custom") {
      // Wait until both dates are picked before fetching a custom range.
      if (!customFrom || !customTo) return;
      fromIso = toIsoBoundary(customFrom, "start");
      toIso = toIsoBoundary(customTo, "end");
      if (!fromIso || !toIso) return;
    } else {
      const now = new Date();
      toIso = now.toISOString();
      fromIso = new Date(now.getTime() - Number(preset) * 86_400_000).toISOString();
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ from: fromIso, to: toIso });

    setLoading(true);
    apiFetch<DashboardData>(`/api/admin/dashboard?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setStats(result);
        setLoadFailed(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setLoading(false);
        toast.error("Failed to load dashboard", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [preset, customFrom, customTo, refreshKey]);

  const showSkeleton = loading && !stats;
  const showError = loadFailed && !loading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={preset}
          onValueChange={(value) => {
            const next = value as RangePreset;
            if (next === "custom" && !customFrom && !customTo) {
              // Prefill the custom inputs with the window we're leaving.
              const days = preset === "custom" ? 30 : Number(preset);
              setCustomFrom(toDateInput(new Date(Date.now() - days * 86_400_000)));
              setCustomTo(toDateInput(new Date()));
            }
            setPreset(next);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset === "custom" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="dashboard-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="dashboard-from"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dashboard-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="dashboard-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-40"
              />
            </div>
          </>
        ) : null}
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load the dashboard"
          description="Something went wrong while loading dashboard stats. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showSkeleton || !stats ? (
        <DashboardSkeleton />
      ) : (
        <div aria-busy={loading} className={cn("space-y-4", loading && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Revenue"
              value={formatMoney(stats.revenue, currency)}
              delta={<Delta current={stats.revenue} previous={stats.previous.revenue} />}
            />
            <StatCard
              label="Orders"
              value={String(stats.orderCount)}
              delta={<Delta current={stats.orderCount} previous={stats.previous.orderCount} />}
            />
            <StatCard
              label="Avg order value"
              value={formatMoney(stats.aov, currency)}
              delta={<Delta current={stats.aov} previous={stats.previous.aov} />}
            />
            <Link
              href="/inventory"
              className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={`Low stock: ${stats.lowStock.low} variants low, ${stats.lowStock.out} out of stock — view inventory`}
            >
              <Card className="h-full gap-1 transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardDescription>Low stock</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums">
                      {stats.lowStock.low}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {stats.lowStock.out} out of stock
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenue by day</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart data={fillDays(stats.range, stats.revenueByDay)} currency={currency} />
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Top products</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {stats.topProducts.length === 0 ? (
                  <p className="px-(--card-spacing) py-6 text-sm text-muted-foreground">
                    No sales in this period.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Units</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.topProducts.map((product) => (
                          <TableRow key={product.productTitle}>
                            <TableCell className="max-w-64 truncate font-medium">
                              {product.productTitle}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {product.unitsSold}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatMoney(product.revenue, currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Recent orders</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {stats.recentOrders.length === 0 ? (
                  <p className="px-(--card-spacing) py-6 text-sm text-muted-foreground">
                    No orders yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {stats.recentOrders.map((order) => (
                      <li
                        key={order.id}
                        className="flex items-center justify-between gap-3 px-(--card-spacing) py-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/orders/${order.id}`}
                            className="font-medium hover:underline"
                          >
                            {order.orderNumber}
                          </Link>
                          <p className="truncate text-sm text-muted-foreground">{order.email}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={orderStatusVariant(order.status)}>
                              {orderStatusLabel(order.status)}
                            </Badge>
                            <span className="font-medium tabular-nums">
                              {formatMoney(order.grandTotal, order.currency)}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(order.createdAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
