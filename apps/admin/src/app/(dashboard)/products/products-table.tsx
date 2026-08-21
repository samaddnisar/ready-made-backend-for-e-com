"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ImageIcon, Package, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import type { ProductListItem } from "@repo/core";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate, formatMoneyRange } from "@/lib/format";

/** Wire shape: dates arrive as ISO strings over JSON. */
type ProductRow = Omit<ProductListItem, "updatedAt"> & { updatedAt: string };

type StatusFilter = "all" | "draft" | "active" | "archived";

const SORT_OPTIONS = [
  { value: "updatedAt:desc", label: "Recently updated" },
  { value: "updatedAt:asc", label: "Least recently updated" },
  { value: "createdAt:desc", label: "Newest" },
  { value: "createdAt:asc", label: "Oldest" },
  { value: "title:asc", label: "Title A–Z" },
  { value: "title:desc", label: "Title Z–A" },
  { value: "price:asc", label: "Price: low to high" },
  { value: "price:desc", label: "Price: high to low" },
] as const;

const STATUS_BADGE_VARIANT: Record<ProductRow["status"], "default" | "secondary" | "outline"> = {
  draft: "secondary",
  active: "default",
  archived: "outline",
};

const PAGE_SIZE = 20;

export function ProductsTable({ currency, canWrite }: { currency: string; canWrite: boolean }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<string>("updatedAt:desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ProductRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
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
    const [sortField, order] = sort.split(":");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: sortField ?? "updatedAt",
      order: order ?? "desc",
    });
    if (debouncedQ) params.set("q", debouncedQ);
    if (status !== "all") params.set("status", status);

    setLoading(true);
    apiFetch<Paginated<ProductRow>>(`/api/admin/products?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        toast.error("Failed to load products", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [debouncedQ, status, sort, page, refreshKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const item of items) {
          if (checked) next.add(item.id);
          else next.delete(item.id);
        }
        return next;
      });
    },
    [items],
  );

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  async function runBulk(action: "publish" | "draft" | "archive" | "delete") {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const { affected } = await apiFetch<{ affected: number }>("/api/admin/products/bulk", {
        method: "POST",
        body: { ids: Array.from(selected), action },
      });
      const verb =
        action === "publish"
          ? "published"
          : action === "draft"
            ? "moved to draft"
            : action === "archive"
              ? "archived"
              : "deleted";
      toast.success(`${affected} ${affected === 1 ? "product" : "products"} ${verb}`);
      setSelected(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error("Bulk action failed", {
        description: err instanceof ApiError ? err.message : "Something went wrong",
      });
    } finally {
      setBulkBusy(false);
    }
  }

  const hasFilters = debouncedQ !== "" || status !== "all";
  const showSkeleton = loading && !data;
  const showEmpty = !showSkeleton && items.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title, slug or SKU…"
            className="pl-8"
            aria-label="Search products"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(value) => {
            setSort(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-52" aria-label="Sort products">
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

      {canWrite && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => runBulk("publish")}>
              Publish
            </Button>
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => runBulk("draft")}>
              Draft
            </Button>
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => runBulk("archive")}>
              Archive
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkBusy}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      {showEmpty ? (
        <EmptyState
          icon={Package}
          title={hasFilters ? "No products match" : "No products yet"}
          description={
            hasFilters
              ? "Try a different search or clear the status filter."
              : "Create your first product to start building the catalog."
          }
          action={
            canWrite && !hasFilters ? (
              <Button asChild>
                <Link href="/products/new">
                  <Plus className="size-4" aria-hidden />
                  New product
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {canWrite ? (
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) => toggleAll(checked === true)}
                        aria-label="Select all products on this page"
                      />
                    </TableHead>
                  ) : null}
                  <TableHead className="w-14">Image</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="text-right">Variants</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {showSkeleton
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {canWrite ? (
                          <TableCell className="pl-4">
                            <Skeleton className="size-4" />
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Skeleton className="size-10 rounded-md" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-48" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-16 rounded-full" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="ml-auto h-4 w-8" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="ml-auto h-4 w-8" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((item) => (
                      <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                        {canWrite ? (
                          <TableCell className="pl-4">
                            <Checkbox
                              checked={selected.has(item.id)}
                              onCheckedChange={(checked) => toggleOne(item.id, checked === true)}
                              aria-label={`Select ${item.title}`}
                            />
                          </TableCell>
                        ) : null}
                        <TableCell>
                          {item.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.thumbnailUrl}
                              alt=""
                              className="size-10 rounded-md border object-cover"
                            />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded-md border bg-muted">
                              <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/products/${item.id}`}
                            className="font-medium hover:underline"
                          >
                            {item.title}
                          </Link>
                          <p className="text-xs text-muted-foreground">/{item.slug}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE_VARIANT[item.status]} className="capitalize">
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatMoneyRange(item.minPrice, item.maxPrice, currency)}</TableCell>
                        <TableCell className="text-right">{item.variantCount}</TableCell>
                        <TableCell className="text-right">
                          {item.totalStock === null ? "—" : item.totalStock}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(item.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && data.total > 0 ? (
        <TablePagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          onPageChange={setPage}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${selected.size} ${selected.size === 1 ? "product" : "products"}?`}
        description="The selected products will be removed from the catalog. Existing orders keep their purchase snapshots."
        confirmLabel="Delete"
        onConfirm={async () => {
          setConfirmDeleteOpen(false);
          await runBulk("delete");
        }}
      />
    </div>
  );
}
