"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Award, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import type { LoyaltyAccountListItem, LoyaltyLedgerItem } from "@repo/core";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { formatDate } from "@/lib/format";

/** Wire shapes: dates arrive as ISO strings over JSON. */
type AccountRow = Omit<LoyaltyAccountListItem, "lastActivityAt" | "createdAt"> & {
  lastActivityAt: string;
  createdAt: string;
};

type LedgerRow = Omit<LoyaltyLedgerItem, "createdAt"> & { createdAt: string };

type DetailView = {
  customer: { id: string; email: string; firstName: string | null; lastName: string | null };
  balance: number;
  ledger: Paginated<LedgerRow>;
};

const PAGE_SIZE = 20;
const LEDGER_PAGE_SIZE = 10;

export function LoyaltyClient({ canAdjust }: { canAdjust: boolean }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AccountRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<AccountRow | null>(null);

  // Debounce the email search (300ms) and reset to page 1 on change.
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

    setLoading(true);
    apiFetch<Paginated<AccountRow>>(`/api/admin/loyalty?${params.toString()}`, {
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
        toast.error("Failed to load loyalty accounts", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [debouncedQ, page, refreshKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const hasFilters = debouncedQ !== "";
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && items.length === 0;

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by customer email…"
          className="pl-8"
          aria-label="Search loyalty accounts"
        />
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load loyalty accounts"
          description="Something went wrong while loading the account list. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={Award}
          title={hasFilters ? "No accounts match" : "No loyalty accounts yet"}
          description={
            hasFilters
              ? "Try a different email."
              : "Accounts appear automatically the first time a signed-in customer earns points on a paid order."
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
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead>Member since</TableHead>
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
                            <Skeleton className="ml-auto h-4 w-12" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                        </TableRow>
                      ))
                    : items.map((account) => {
                        const name =
                          [account.firstName, account.lastName].filter(Boolean).join(" ") || "—";
                        return (
                          <TableRow
                            key={account.id}
                            className="cursor-pointer"
                            onClick={() => setSelected(account)}
                          >
                            <TableCell>
                              <p className="font-medium">{name}</p>
                              <Link
                                href={`/customers/${account.customerId}`}
                                className="text-sm text-muted-foreground hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {account.email}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {account.balance.toLocaleString("en-US")}{" "}
                              <span className="font-normal text-muted-foreground">pts</span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(account.lastActivityAt)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(account.createdAt)}
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

      {selected ? (
        <DetailDialog
          customerId={selected.customerId}
          canAdjust={canAdjust}
          onClose={() => setSelected(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      ) : null}
    </div>
  );
}

/** One ledger row: order earns render as a link to the order, adjustments show their reason. */
function LedgerLine({ entry }: { entry: LedgerRow }) {
  const isOrderEarn = entry.orderId !== null && entry.reason === `order:${entry.orderId}`;
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0">
        {isOrderEarn ? (
          <Link
            href={`/orders/${entry.orderId}`}
            className="text-muted-foreground hover:underline"
          >
            Earned on order
          </Link>
        ) : (
          <span className="block truncate" title={entry.reason}>
            {entry.reason}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={entry.delta >= 0 ? "secondary" : "outline"} className="tabular-nums">
          {entry.delta > 0 ? `+${entry.delta.toLocaleString("en-US")}` : entry.delta.toLocaleString("en-US")}
        </Badge>
        <span className="text-muted-foreground">{formatDate(entry.createdAt)}</span>
      </div>
    </li>
  );
}

function DetailDialog({
  customerId,
  canAdjust,
  onClose,
  onChanged,
}: {
  customerId: string;
  canAdjust: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (page: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(LEDGER_PAGE_SIZE),
        });
        const view = await apiFetch<DetailView>(
          `/api/admin/loyalty/${customerId}?${params.toString()}`,
          { signal: controller.signal },
        );
        setDetail(view);
        setLoadFailed(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        toast.error("Failed to load loyalty account", {
          description: err instanceof ApiError ? err.message : undefined,
        });
      }
    },
    [customerId],
  );

  useEffect(() => {
    void load(ledgerPage);
    return () => abortRef.current?.abort();
  }, [load, ledgerPage]);

  const parsedDelta = useMemo(() => Number.parseInt(delta, 10), [delta]);
  const resulting =
    detail === null || Number.isNaN(parsedDelta) ? null : detail.balance + parsedDelta;
  const invalidAdjust =
    Number.isNaN(parsedDelta) || parsedDelta === 0 || !reason.trim() || (resulting ?? 0) < 0;

  async function adjust() {
    if (Number.isNaN(parsedDelta) || parsedDelta === 0 || !reason.trim()) {
      toast.error("Enter a non-zero adjustment and a reason");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/loyalty/${customerId}`, {
        method: "POST",
        body: { delta: parsedDelta, reason: reason.trim() },
      });
      toast.success("Points adjusted");
      setDelta("");
      setReason("");
      setLedgerPage(1);
      await load(1);
      onChanged();
    } catch (err) {
      toast.error("Adjustment failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  const name = detail
    ? [detail.customer.firstName, detail.customer.lastName].filter(Boolean).join(" ")
    : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Loyalty account</DialogTitle>
          <DialogDescription>
            {detail ? (
              <>
                {name ? `${name} · ` : ""}
                <Link
                  href={`/customers/${customerId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {detail.customer.email}
                </Link>
              </>
            ) : (
              "Loading account…"
            )}
          </DialogDescription>
        </DialogHeader>

        {detail === null ? (
          loadFailed ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load this account.</p>
              <Button variant="outline" onClick={() => void load(ledgerPage)}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Current balance</p>
              <p className="text-3xl font-semibold tabular-nums">
                {detail.balance.toLocaleString("en-US")}{" "}
                <span className="text-base font-normal text-muted-foreground">points</span>
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Ledger</p>
              {detail.ledger.items.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ul className="divide-y">
                  {detail.ledger.items.map((entry) => (
                    <LedgerLine key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
              {detail.ledger.totalPages > 1 ? (
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground">
                    Page {detail.ledger.page} of {detail.ledger.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={detail.ledger.page <= 1}
                      onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={detail.ledger.page >= detail.ledger.totalPages}
                      onClick={() => setLedgerPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {canAdjust ? (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">Manual adjustment</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="loyalty-delta">Points (+ credit, − debit)</Label>
                    <Input
                      id="loyalty-delta"
                      type="number"
                      step={1}
                      value={delta}
                      onChange={(e) => setDelta(e.target.value)}
                      placeholder="e.g. 100 or -50"
                    />
                    {resulting !== null ? (
                      <p
                        className={`text-sm ${resulting < 0 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        New balance: {resulting.toLocaleString("en-US")}
                        {resulting < 0 ? " — can't go negative" : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="loyalty-reason">Reason</Label>
                    <Input
                      id="loyalty-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Goodwill credit, support gesture"
                      maxLength={500}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={adjust} disabled={saving || invalidAdjust}>
                      Apply adjustment
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
