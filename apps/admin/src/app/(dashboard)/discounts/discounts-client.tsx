"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal, Plus, TicketPercent, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate, formatMoney } from "@/lib/format";
import { DiscountDialog } from "./discount-dialog";
import {
  APPLIES_TO_LABELS,
  describeApiError,
  DISCOUNT_TYPE_LABELS,
  type DiscountRow,
  type DiscountType,
} from "./discount-shared";

type ActiveFilter = "all" | "active" | "inactive";

const PAGE_SIZE = 20;

const TYPE_BADGE_VARIANT: Record<DiscountType, "default" | "secondary" | "outline"> = {
  percent: "secondary",
  fixed: "outline",
  free_shipping: "default",
};

/** { id: null } = create, { id } = edit, null = closed. */
type DialogState = { id: string | null } | null;

export function DiscountsClient({ currency, canWrite }: { currency: string; canWrite: boolean }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<DiscountRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<DiscountRow | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

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
    if (activeFilter !== "all") params.set("active", activeFilter === "active" ? "true" : "false");

    setLoading(true);
    apiFetch<Paginated<DiscountRow>>(`/api/admin/discounts?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setLoadFailed(false);
        setLoading(false);
        // Deleting the last row of the last page can leave us on a page that
        // no longer exists — clamp back to the last real page.
        if (result.totalPages < page) setPage(Math.max(1, result.totalPages));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setLoading(false);
        toast.error("Failed to load discounts", { description: describeApiError(err) });
      });
    return () => controller.abort();
  }, [debouncedQ, activeFilter, page, refreshKey]);

  async function toggleActive(row: DiscountRow, next: boolean) {
    setTogglingId(row.id);
    try {
      await apiFetch<DiscountRow>(`/api/admin/discounts/${row.id}`, {
        method: "PATCH",
        body: { isActive: next },
      });
      toast.success(next ? `${row.code} activated` : `${row.code} deactivated`);
      refresh();
    } catch (err) {
      toast.error("Update failed", { description: describeApiError(err) });
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const row = deleting;
    try {
      await apiFetch<{ deleted: boolean }>(`/api/admin/discounts/${row.id}`, { method: "DELETE" });
      toast.success(`${row.code} deleted`);
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 409 ? "Discount in use" : "Delete failed",
        { description: describeApiError(err) },
      );
    } finally {
      setDeleting(null);
    }
  }

  const rows = data?.items ?? [];
  const filtered = Boolean(debouncedQ) || activeFilter !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search codes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={activeFilter}
          onValueChange={(v) => {
            setActiveFilter(v as ActiveFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {canWrite ? (
          <Button className="ml-auto" onClick={() => setDialog({ id: null })}>
            <Plus className="size-4" aria-hidden />
            New discount
          </Button>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : loadFailed && rows.length === 0 ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load discounts"
          description="Something went wrong while fetching discounts."
          action={
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={TicketPercent}
          title={filtered ? "No matching discounts" : "No discounts yet"}
          description={
            filtered
              ? "Try a different search or filter."
              : "Create your first discount code to offer percent, fixed-amount or free-shipping promotions."
          }
          action={
            canWrite && !filtered ? (
              <Button onClick={() => setDialog({ id: null })}>
                <Plus className="size-4" aria-hidden />
                New discount
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Usage</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Stackable</TableHead>
                <TableHead>Active</TableHead>
                {canWrite ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono font-medium">{row.code}</TableCell>
                  <TableCell>
                    <Badge variant={TYPE_BADGE_VARIANT[row.type]}>
                      {DISCOUNT_TYPE_LABELS[row.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.type === "percent"
                      ? `${row.value}%`
                      : row.type === "fixed"
                        ? formatMoney(row.value, currency)
                        : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {APPLIES_TO_LABELS[row.appliesTo]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.redemptionCount} / {row.usageLimit ?? "∞"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {!row.startsAt && !row.endsAt
                      ? "Always"
                      : `${row.startsAt ? formatDate(row.startsAt) : "—"} – ${
                          row.endsAt ? formatDate(row.endsAt) : "—"
                        }`}
                  </TableCell>
                  <TableCell>
                    {row.stackable ? (
                      <Badge variant="outline">Stackable</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canWrite ? (
                      <Switch
                        checked={row.isActive}
                        disabled={togglingId === row.id}
                        onCheckedChange={(v) => void toggleActive(row, v)}
                        aria-label={`${row.code} active`}
                      />
                    ) : row.isActive ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Row actions">
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialog({ id: row.id })}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(row)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.total > 0 ? (
        <TablePagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          onPageChange={setPage}
        />
      ) : null}

      {dialog ? (
        <DiscountDialog
          discountId={dialog.id}
          currency={currency}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.code ?? "discount"}?`}
        description="This permanently removes the discount code. Codes that have already been redeemed can't be deleted — deactivate them instead to keep usage history."
        onConfirm={confirmDelete}
      />
    </div>
  );
}
