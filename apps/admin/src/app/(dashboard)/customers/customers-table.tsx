"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, TriangleAlert, Users } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import type { CustomerListItem } from "@repo/core";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
type CustomerRow = Omit<CustomerListItem, "createdAt"> & { createdAt: string };

/** Combined sort value: `${listCustomersQuerySchema.sort}:${listCustomersQuerySchema.order}`. */
type SortValue = "createdAt:desc" | "createdAt:asc" | "lifetimeValue:desc" | "orderCount:desc";

const SORT_OPTIONS: { value: SortValue; label: string }[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "lifetimeValue:desc", label: "Lifetime value: high to low" },
  { value: "orderCount:desc", label: "Most orders" },
];

const PAGE_SIZE = 20;

export function CustomersTable({
  currency,
  canWrite: _canWrite,
}: {
  currency: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<SortValue>("createdAt:desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<CustomerRow> | null>(null);
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
    const [sortField, sortOrder] = sort.split(":") as [
      "createdAt" | "lifetimeValue" | "orderCount",
      "asc" | "desc",
    ];
    params.set("sort", sortField);
    params.set("order", sortOrder);

    setLoading(true);
    apiFetch<Paginated<CustomerRow>>(`/api/admin/customers?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setLoadFailed(false);
        setLoading(false);
        // A shrinking result set can strand the current page — clamp back.
        if (result.totalPages < page) setPage(Math.max(1, result.totalPages));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setLoading(false);
        toast.error("Failed to load customers", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [debouncedQ, sort, page, refreshKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const hasFilters = debouncedQ !== "";
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
            placeholder="Search by name or email…"
            className="pl-8"
            aria-label="Search customers"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(value) => {
            setSort(value as SortValue);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Sort customers">
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
          title="Couldn't load customers"
          description="Something went wrong while loading the customer list. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? "No customers match" : "No customers yet"}
          description={
            hasFilters
              ? "Try a different name or email."
              : "Customers appear here after their first checkout or account signup."
          }
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Marketing</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Lifetime value</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-36" />
                              <Skeleton className="h-3 w-48" />
                            </div>
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
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                        </TableRow>
                      ))
                    : items.map((customer) => {
                        const name =
                          [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "—";
                        return (
                          <TableRow
                            key={customer.id}
                            className="cursor-pointer"
                            onClick={() => router.push(`/customers/${customer.id}`)}
                          >
                            <TableCell>
                              <p className="font-medium">{name}</p>
                              <p className="text-sm text-muted-foreground">{customer.email}</p>
                            </TableCell>
                            <TableCell>
                              {customer.marketingOptIn ? (
                                <Badge variant="secondary">
                                  <span
                                    className="size-1.5 rounded-full bg-emerald-500"
                                    aria-hidden
                                  />
                                  Opted in
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  <span
                                    className="size-1.5 rounded-full bg-muted-foreground/40"
                                    aria-hidden
                                  />
                                  Opted out
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {customer.orderCount}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatMoney(customer.lifetimeValue, currency)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(customer.createdAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
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
