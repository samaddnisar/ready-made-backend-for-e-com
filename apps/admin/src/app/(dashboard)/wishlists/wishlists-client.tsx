"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, Heart, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { WishlistSummary } from "@repo/core";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const PAGE_SIZE = 20;

export function WishlistsClient() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<WishlistSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });

    setLoading(true);
    apiFetch<WishlistSummary>(`/api/admin/wishlists?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setLoadFailed(false);
        setLoading(false);
        // A shrinking result set can strand the current page — clamp back.
        if (result.products.totalPages < page) setPage(Math.max(1, result.products.totalPages));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setLoading(false);
        toast.error("Failed to load wishlists", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [page, refreshKey]);

  const items = data?.products.items ?? [];
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && items.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Total wishlists</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {showSkeleton ? <Skeleton className="h-8 w-16" /> : (data?.totalWishlists ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Total saved items</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {showSkeleton ? <Skeleton className="h-8 w-16" /> : (data?.totalItems ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load wishlists"
          description="Something went wrong while loading the wishlist summary. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={Heart}
          title="No wishlisted products yet"
          description="Products appear here once customers start saving them to their wishlists."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Times saved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-44" />
                              <Skeleton className="h-3 w-28" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Skeleton className="ml-auto h-4 w-10" />
                          </TableCell>
                        </TableRow>
                      ))
                    : items.map((row) => (
                        <TableRow key={row.productId}>
                          <TableCell>
                            <Link
                              href={`/products/${row.productId}`}
                              className="font-medium hover:underline"
                            >
                              {row.title}
                            </Link>
                            <p className="text-sm text-muted-foreground">{row.slug}</p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className="inline-flex items-center gap-1.5">
                              <Bookmark className="size-3.5 text-muted-foreground" aria-hidden />
                              {row.count}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!showError && data && data.products.total > 0 ? (
        <TablePagination
          page={data.products.page}
          totalPages={data.products.totalPages}
          total={data.products.total}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
