"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import type { NewsletterSubscriber } from "@repo/core";
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
import { formatDate } from "@/lib/format";

/** Wire shape: dates arrive as ISO strings over JSON. */
type SubscriberRow = Omit<
  NewsletterSubscriber,
  "subscribedAt" | "unsubscribedAt" | "createdAt" | "updatedAt"
> & {
  subscribedAt: string;
  unsubscribedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SubscriberList = Paginated<SubscriberRow> & { activeCount: number };

/** Status filter: maps to listNewsletterQuerySchema's `active` stringbool. */
type StatusFilter = "all" | "true" | "false";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "true", label: "Active" },
  { value: "false", label: "Unsubscribed" },
];

const PAGE_SIZE = 20;

export function NewsletterClient() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SubscriberList | null>(null);
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
    if (status !== "all") params.set("active", status);

    setLoading(true);
    apiFetch<SubscriberList>(`/api/admin/newsletter?${params.toString()}`, {
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
        toast.error("Failed to load subscribers", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [debouncedQ, status, page, refreshKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const hasFilters = debouncedQ !== "" || status !== "all";
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && items.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:max-w-xs">
        <Card>
          <CardContent className="space-y-1">
            <p className="text-sm text-muted-foreground">Active subscribers</p>
            {data ? (
              <p className="text-2xl font-semibold tabular-nums">{data.activeCount}</p>
            ) : (
              <Skeleton className="h-8 w-16" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by email…"
            className="pl-8"
            aria-label="Search subscribers"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
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
          title="Couldn't load subscribers"
          description="Something went wrong while loading the subscriber list. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={Mail}
          title={hasFilters ? "No subscribers match" : "No subscribers yet"}
          description={
            hasFilters
              ? "Try a different email or status filter."
              : "Subscribers appear here once visitors sign up through the storefront."
          }
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Subscribed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-4 w-48" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-24 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-28" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                        </TableRow>
                      ))
                    : items.map((subscriber) => (
                        <TableRow key={subscriber.id}>
                          <TableCell className="font-medium">{subscriber.email}</TableCell>
                          <TableCell>
                            {subscriber.isActive ? (
                              <Badge variant="secondary">
                                <span
                                  className="size-1.5 rounded-full bg-emerald-500"
                                  aria-hidden
                                />
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                <span
                                  className="size-1.5 rounded-full bg-muted-foreground/40"
                                  aria-hidden
                                />
                                Unsubscribed
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {subscriber.source ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(subscriber.subscribedAt)}
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
