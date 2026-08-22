"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Check, Search, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import type { AdminReviewListItem, ReviewStatus } from "@repo/core";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/client-api";
import { formatDate } from "@/lib/format";

/** Wire shape: dates arrive as ISO strings over JSON. */
type ReviewRow = Omit<AdminReviewListItem, "createdAt"> & { createdAt: string };

type TabValue = ReviewStatus | "all";

const TABS: { value: TabValue; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 20;

function describeError(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function excerpt(text: string | null, max = 120): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span
      className="text-sm whitespace-nowrap"
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      <span className="text-amber-500" aria-hidden>
        {"★".repeat(rating)}
      </span>
      <span className="text-muted-foreground/30" aria-hidden>
        {"★".repeat(5 - rating)}
      </span>
    </span>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "approved") {
    return (
      <Badge variant="secondary">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="outline">
        <span className="size-1.5 rounded-full bg-red-500" aria-hidden />
        Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
      Pending
    </Badge>
  );
}

export function ReviewsClient({
  canModerate,
  canDelete,
}: {
  canModerate: boolean;
  canDelete: boolean;
}) {
  const [tab, setTab] = useState<TabValue>("pending");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ReviewRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReviewRow | null>(null);

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
    if (tab !== "all") params.set("status", tab);
    if (debouncedQ) params.set("q", debouncedQ);

    setLoading(true);
    apiFetch<Paginated<ReviewRow>>(`/api/admin/reviews?${params.toString()}`, {
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
        toast.error("Failed to load reviews", { description: describeError(err) });
      });
    return () => controller.abort();
  }, [tab, debouncedQ, page, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  async function moderate(row: ReviewRow, status: "approved" | "rejected") {
    setActingId(row.id);
    try {
      await apiFetch(`/api/admin/reviews/${row.id}`, { method: "PATCH", body: { status } });
      toast.success(status === "approved" ? "Review approved" : "Review rejected");
      refresh();
    } catch (err) {
      toast.error("Moderation failed", { description: describeError(err) });
    } finally {
      setActingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const row = deleting;
    try {
      await apiFetch<{ deleted: boolean }>(`/api/admin/reviews/${row.id}`, { method: "DELETE" });
      toast.success("Review deleted");
      refresh();
    } catch (err) {
      toast.error("Delete failed", { description: describeError(err) });
    } finally {
      setDeleting(null);
    }
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const showStatus = tab === "all";
  const showActions = canModerate || canDelete;
  const hasFilters = debouncedQ !== "";
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && items.length === 0;

  const emptyCopy: Record<TabValue, { title: string; description: string }> = {
    pending: {
      title: "No reviews awaiting moderation",
      description: "New customer reviews land here for approval before they go live.",
    },
    approved: {
      title: "No approved reviews",
      description: "Reviews you approve appear here and on the storefront.",
    },
    rejected: {
      title: "No rejected reviews",
      description: "Reviews you reject are kept here and never shown on the storefront.",
    },
    all: {
      title: "No reviews yet",
      description: "Customer reviews appear here once shoppers start leaving them.",
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabValue);
            setPage(1);
          }}
        >
          <TabsList aria-label="Filter reviews by status">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-3">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative min-w-56 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by product title…"
            className="pl-8"
            aria-label="Search reviews by product title"
          />
        </div>
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load reviews"
          description="Something went wrong while loading the review queue. Check your connection and try again."
          action={
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={Star}
          title={hasFilters ? "No reviews match" : emptyCopy[tab].title}
          description={hasFilters ? "Try a different product title." : emptyCopy[tab].description}
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Purchase</TableHead>
                    {showStatus ? <TableHead>Status</TableHead> : null}
                    <TableHead>Submitted</TableHead>
                    {showActions ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-20" />
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-40" />
                              <Skeleton className="h-3 w-56" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-28" />
                              <Skeleton className="h-3 w-36" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-20 rounded-full" />
                          </TableCell>
                          {showStatus ? (
                            <TableCell>
                              <Skeleton className="h-5 w-20 rounded-full" />
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          {showActions ? (
                            <TableCell>
                              <Skeleton className="ml-auto h-8 w-28" />
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))
                    : items.map((review) => {
                        const busy = actingId === review.id;
                        return (
                          <TableRow key={review.id}>
                            <TableCell className="max-w-48">
                              <p className="truncate font-medium" title={review.productTitle}>
                                {review.productTitle}
                              </p>
                            </TableCell>
                            <TableCell>
                              <RatingStars rating={review.rating} />
                            </TableCell>
                            <TableCell className="max-w-md">
                              {review.title ? <p className="font-medium">{review.title}</p> : null}
                              {review.body ? (
                                <p className="text-sm text-muted-foreground">
                                  {excerpt(review.body)}
                                </p>
                              ) : null}
                              {!review.title && !review.body ? (
                                <span className="text-muted-foreground">—</span>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">{review.customerName ?? "—"}</p>
                              {review.customerEmail ? (
                                <p className="text-sm text-muted-foreground">
                                  {review.customerEmail}
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {review.verifiedPurchase ? (
                                <Badge variant="secondary">
                                  <BadgeCheck className="size-3 text-emerald-500" aria-hidden />
                                  Verified
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            {showStatus ? (
                              <TableCell>
                                <StatusBadge status={review.status} />
                              </TableCell>
                            ) : null}
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatDate(review.createdAt)}
                            </TableCell>
                            {showActions ? (
                              <TableCell>
                                <div className="flex items-center justify-end gap-1">
                                  {canModerate && review.status !== "approved" ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={busy}
                                      onClick={() => moderate(review, "approved")}
                                    >
                                      <Check className="size-4" aria-hidden />
                                      Approve
                                    </Button>
                                  ) : null}
                                  {canModerate && review.status !== "rejected" ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={busy}
                                      onClick={() => moderate(review, "rejected")}
                                    >
                                      <X className="size-4" aria-hidden />
                                      Reject
                                    </Button>
                                  ) : null}
                                  {canDelete ? (
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      disabled={busy}
                                      onClick={() => setDeleting(review)}
                                      aria-label="Delete review"
                                    >
                                      <Trash2 className="size-4 text-destructive" aria-hidden />
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            ) : null}
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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this review?"
        description={
          deleting
            ? `The review of "${deleting.productTitle}" will be permanently removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
