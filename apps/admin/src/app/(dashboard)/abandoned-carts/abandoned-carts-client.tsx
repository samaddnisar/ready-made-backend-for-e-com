"use client";

import { useEffect, useState } from "react";
import { Mail, RefreshCw, ShoppingCart, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { AbandonedCartDetectionResult, AbandonedCartListItem } from "@repo/core";
import type { Paginated } from "@repo/core/validation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
type AbandonedRow = Omit<AbandonedCartListItem, "abandonedAt" | "reminderSentAt" | "recoveredAt"> & {
  abandonedAt: string;
  reminderSentAt: string | null;
  recoveredAt: string | null;
};

const PAGE_SIZE = 20;

export function AbandonedCartsClient({
  canDetect,
  canRemind,
}: {
  canDetect: boolean;
  canRemind: boolean;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AbandonedRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [remindTarget, setRemindTarget] = useState<AbandonedRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });

    setLoading(true);
    apiFetch<Paginated<AbandonedRow>>(`/api/admin/abandoned-carts?${params.toString()}`, {
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
        toast.error("Failed to load abandoned carts", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [page, refreshKey]);

  async function runDetection() {
    setDetecting(true);
    try {
      const result = await apiFetch<AbandonedCartDetectionResult>("/api/admin/abandoned-carts", {
        method: "POST",
        body: { action: "detect" },
      });
      toast.success(
        result.detected === 0
          ? "No new abandoned carts found"
          : `Flagged ${result.detected} abandoned ${result.detected === 1 ? "cart" : "carts"}`,
      );
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      toast.error("Detection failed", {
        description: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setDetecting(false);
    }
  }

  async function sendReminder(row: AbandonedRow) {
    setSendingId(row.id);
    try {
      await apiFetch(`/api/admin/abandoned-carts/${row.id}/remind`, { method: "POST" });
      toast.success(`Reminder sent to ${row.email ?? "the customer"}`);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      toast.error("Failed to send reminder", {
        description: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setSendingId(null);
    }
  }

  const items = data?.items ?? [];
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && items.length === 0;

  return (
    <div className="space-y-4">
      {canDetect ? (
        <div className="flex justify-end">
          <Button onClick={() => void runDetection()} disabled={detecting}>
            <RefreshCw className={detecting ? "animate-spin" : undefined} aria-hidden />
            {detecting ? "Detecting…" : "Detect now"}
          </Button>
        </div>
      ) : null}

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load abandoned carts"
          description="Something went wrong while loading the list. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={ShoppingCart}
          title="No abandoned carts"
          description="Carts appear here when detection flags active carts that went quiet before checkout. Run detection to check now."
          action={
            canDetect ? (
              <Button variant="outline" onClick={() => void runDetection()} disabled={detecting}>
                {detecting ? "Detecting…" : "Detect now"}
              </Button>
            ) : undefined
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
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Abandoned</TableHead>
                    <TableHead>Reminder</TableHead>
                    <TableHead>Recovered</TableHead>
                    {canRemind ? <TableHead className="w-32" /> : null}
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
                            <Skeleton className="ml-auto h-4 w-8" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="ml-auto h-4 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-20 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-20 rounded-full" />
                          </TableCell>
                          {canRemind ? (
                            <TableCell>
                              <Skeleton className="h-8 w-28" />
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))
                    : items.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.email ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.itemCount}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.cartValue, row.currency)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(row.abandonedAt)}
                          </TableCell>
                          <TableCell>
                            {row.reminderSentAt ? (
                              <Badge variant="secondary">
                                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                                Sent
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                <span
                                  className="size-1.5 rounded-full bg-muted-foreground/40"
                                  aria-hidden
                                />
                                Not sent
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.recoveredAt ? (
                              <Badge variant="secondary">
                                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                                Recovered
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          {canRemind ? (
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRemindTarget(row)}
                                disabled={
                                  row.reminderSentAt !== null ||
                                  row.email === null ||
                                  sendingId === row.id
                                }
                              >
                                <Mail aria-hidden />
                                {sendingId === row.id ? "Sending…" : "Send reminder"}
                              </Button>
                            </TableCell>
                          ) : null}
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

      <ConfirmDialog
        open={remindTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemindTarget(null);
        }}
        title="Send reminder email?"
        description={
          remindTarget
            ? `This will email ${remindTarget.email ?? "the customer"} a reminder about their abandoned cart (${formatMoney(remindTarget.cartValue, remindTarget.currency)}). Each cart gets one reminder.`
            : ""
        }
        confirmLabel="Send reminder"
        destructive={false}
        onConfirm={() => {
          const target = remindTarget;
          setRemindTarget(null);
          if (target) void sendReminder(target);
        }}
      />
    </div>
  );
}
