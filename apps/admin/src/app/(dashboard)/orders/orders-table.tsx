"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ShoppingCart, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import type { OrderListItem, OrderStatus } from "@repo/core";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

/** Wire shape: dates arrive as ISO strings over JSON. */
type OrderRow = Omit<OrderListItem, "createdAt"> & { createdAt: string };

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Shared status presentation — the detail view imports these too. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  fulfilled: "Fulfilled",
  shipped: "Shipped",
  delivered: "Delivered",
  completed: "Completed",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  cancelled: "Cancelled",
  payment_failed: "Payment failed",
};

export const ORDER_STATUS_BADGE: Record<OrderStatus, BadgeVariant> = {
  pending: "secondary",
  paid: "default",
  fulfilled: "secondary",
  shipped: "secondary",
  delivered: "secondary",
  completed: "default",
  partially_refunded: "outline",
  refunded: "outline",
  cancelled: "outline",
  payment_failed: "destructive",
};

const ALL_STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

/** Combined sort value: `${listOrdersQuerySchema.sort}:${listOrdersQuerySchema.order}`. */
type SortValue = "createdAt:desc" | "createdAt:asc" | "grandTotal:desc" | "grandTotal:asc";

const SORT_OPTIONS: { value: SortValue; label: string }[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "grandTotal:desc", label: "Total: high to low" },
  { value: "grandTotal:asc", label: "Total: low to high" },
];

const PAGE_SIZE = 20;

/** "YYYY-MM-DD" from a date input → ISO datetime (start or end of local day). */
function toIsoBoundary(value: string, boundary: "start" | "end"): string | null {
  const date = new Date(boundary === "start" ? `${value}T00:00:00` : `${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function OrdersTable({ canWrite: _canWrite }: { canWrite: boolean }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<SortValue>("createdAt:desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<OrderRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Debounce the search input (300ms) and reset to page 1 on change.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQ) params.set("q", debouncedQ);
    if (status !== "all") params.set("status", status);
    const fromIso = fromDate ? toIsoBoundary(fromDate, "start") : null;
    const toIso = toDate ? toIsoBoundary(toDate, "end") : null;
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    const [sortField, sortOrder] = sort.split(":") as ["createdAt" | "grandTotal", "asc" | "desc"];
    params.set("sort", sortField);
    params.set("order", sortOrder);

    setLoading(true);
    apiFetch<Paginated<OrderRow>>(`/api/admin/orders?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setLoadFailed(false);
        setLoading(false);
        // Filters can shrink the result set below the current page — clamp back.
        if (result.totalPages < page) setPage(Math.max(1, result.totalPages));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setLoading(false);
        toast.error("Failed to load orders", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [debouncedQ, status, fromDate, toDate, sort, page, refreshKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const hasFilters = debouncedQ !== "" || status !== "all" || fromDate !== "" || toDate !== "";
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && items.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by order # or email…"
            className="pl-8"
            aria-label="Search orders"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as OrderStatus | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <Label htmlFor="orders-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="orders-from"
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="orders-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="orders-to"
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(value) => {
            setSort(value as SortValue);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Sort orders">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load orders"
          description="Something went wrong while loading the order list. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={ShoppingCart}
          title={hasFilters ? "No orders match" : "No orders yet"}
          description={
            hasFilters
              ? "Try a different search, status or date range."
              : "Orders appear here as soon as customers check out."
          }
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-44" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-20 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="ml-auto h-4 w-8" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="ml-auto h-4 w-16" />
                          </TableCell>
                        </TableRow>
                      ))
                    : items.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>
                            <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
                              {order.orderNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(order.createdAt)}
                          </TableCell>
                          <TableCell>{order.email}</TableCell>
                          <TableCell>
                            <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                              {ORDER_STATUS_LABEL[order.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{order.itemCount}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatMoney(order.grandTotal, order.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!showError && data && data.total > 0 ? (
        <TablePagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
