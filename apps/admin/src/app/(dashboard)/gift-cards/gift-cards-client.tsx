"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Gift, Plus, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { GiftCardDetail, GiftCardListItem, GiftCardStatus } from "@repo/core";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate, formatMoney } from "@/lib/format";

/** Wire shapes: dates arrive as ISO strings over JSON. */
type GiftCardRow = Omit<GiftCardListItem, "expiresAt" | "createdAt"> & {
  expiresAt: string | null;
  createdAt: string;
};

type IssuedCard = {
  id: string;
  code: string;
  initialBalance: number;
  currency: string;
  expiresAt: string | null;
};

type LedgerRow = { id: string; delta: number; note: string | null; createdAt: string };

type DetailWire = Omit<
  GiftCardDetail,
  "expiresAt" | "createdAt" | "updatedAt" | "transactions"
> & {
  expiresAt: string | null;
  createdAt: string;
  transactions: LedgerRow[];
};

type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: "all" | GiftCardStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
  { value: "depleted", label: "Depleted" },
];

function StatusBadge({ status }: { status: GiftCardStatus }) {
  if (status === "active") {
    return (
      <Badge variant="secondary">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Active
      </Badge>
    );
  }
  if (status === "disabled") {
    return (
      <Badge variant="destructive">
        <span className="size-1.5 rounded-full bg-white/80" aria-hidden />
        Disabled
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden />
      Depleted
    </Badge>
  );
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success("Code copied to clipboard");
  } catch {
    toast.error("Couldn't copy — select the code manually");
  }
}

/** "42.50" (dollars) → 4250 cents, or null when not a valid amount. */
function parseDollars(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return null;
  return Math.round(parsed * 100);
}

export function GiftCardsClient({
  currency,
  canCreate,
  canUpdate,
}: {
  currency: string;
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | GiftCardStatus>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<GiftCardRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuedCard, setIssuedCard] = useState<IssuedCard | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (q) params.set("q", q);
      if (status !== "all") params.set("status", status);
      const result = await apiFetch<Paginated<GiftCardRow>>(`/api/admin/gift-cards?${params}`);
      setData(result);
      setLoadFailed(false);
      // A shrinking result set can strand the current page — clamp back.
      if (result.totalPages < page) setPage(Math.max(1, result.totalPages));
    } catch (err) {
      setLoadFailed(true);
      toast.error("Failed to load gift cards", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [load, q]);

  const rows = data?.items ?? [];
  const hasFilters = q !== "" || status !== "all";
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && rows.length === 0;

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
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search by code…"
            className="pl-8"
            aria-label="Search gift cards"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as "all" | GiftCardStatus);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canCreate ? (
          <Button onClick={() => setIssueOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Issue gift card
          </Button>
        ) : null}
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load gift cards"
          description="Something went wrong while loading the gift card list. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={Gift}
          title={hasFilters ? "No gift cards match" : "No gift cards yet"}
          description={
            hasFilters
              ? "Try a different code or status filter."
              : "Issue your first gift card and share the code with a customer."
          }
          action={
            canCreate && !hasFilters ? (
              <Button onClick={() => setIssueOpen(true)}>
                <Plus className="size-4" aria-hidden />
                Issue gift card
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
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Created</TableHead>
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
                            <Skeleton className="ml-auto h-4 w-20" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-16 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-36" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        </TableRow>
                      ))
                    : rows.map((card) => (
                        <TableRow
                          key={card.id}
                          className="cursor-pointer"
                          onClick={() => setDetailId(card.id)}
                        >
                          <TableCell className="font-mono text-sm">{card.maskedCode}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className="font-medium">
                              {formatMoney(card.balance, card.currency)}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              / {formatMoney(card.initialBalance, card.currency)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={card.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {card.customerEmail ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {card.expiresAt ? formatDate(card.expiresAt) : "Never"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(card.createdAt)}
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

      {issueOpen ? (
        <IssueDialog
          currency={currency}
          onClose={() => setIssueOpen(false)}
          onIssued={(card) => {
            setIssueOpen(false);
            setIssuedCard(card);
            void load();
          }}
        />
      ) : null}

      {issuedCard ? (
        <IssuedCodeDialog card={issuedCard} onClose={() => setIssuedCard(null)} />
      ) : null}

      {detailId ? (
        <DetailDialog
          id={detailId}
          canUpdate={canUpdate}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}

// ── Issue dialog ─────────────────────────────────────────────

function IssueDialog({
  currency,
  onClose,
  onIssued,
}: {
  currency: string;
  onClose: () => void;
  onIssued: (card: IssuedCard) => void;
}) {
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const cents = parseDollars(amount);

  async function issue() {
    if (cents === null || cents <= 0) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { initialBalance: cents };
      if (expiry) body.expiresAt = new Date(`${expiry}T23:59:59`).toISOString();
      if (note.trim()) body.note = note.trim();

      const card = await apiFetch<IssuedCard>("/api/admin/gift-cards", {
        method: "POST",
        body,
      });
      toast.success("Gift card issued");
      onIssued(card);
    } catch (err) {
      toast.error("Failed to issue gift card", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue gift card</DialogTitle>
          <DialogDescription>
            The card is issued in {currency}. The full code is shown once after issuing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="issue-amount">Amount ({currency})</Label>
            <Input
              id="issue-amount"
              type="number"
              min={0.01}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50.00"
            />
            {cents !== null && cents > 0 ? (
              <p className="text-sm text-muted-foreground">
                Initial balance: {formatMoney(cents, currency)}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="issue-expiry">Expiry date (optional)</Label>
            <Input
              id="issue-expiry"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              The card stays redeemable through the end of this day.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="issue-note">Note (optional)</Label>
            <Textarea
              id="issue-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. Holiday campaign, support goodwill…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={issue} disabled={saving || cents === null || cents <= 0}>
            {saving ? "Issuing…" : "Issue card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Issued-code dialog (full code shown once) ────────────────

function IssuedCodeDialog({ card, onClose }: { card: IssuedCard; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gift card issued</DialogTitle>
          <DialogDescription>
            Copy the code now and share it with the recipient — the list only shows the last 4
            characters.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
            <code className="flex-1 font-mono text-base font-semibold tracking-wide break-all">
              {card.code}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy code"
              onClick={() => void copyCode(card.code)}
            >
              <Copy className="size-4" aria-hidden />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Value: {formatMoney(card.initialBalance, card.currency)}
            {card.expiresAt ? ` · Expires ${formatDate(card.expiresAt)}` : " · Never expires"}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail dialog ────────────────────────────────────────────

function DetailDialog({
  id,
  canUpdate,
  onClose,
  onChanged,
}: {
  id: string;
  canUpdate: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DetailWire | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      setDetail(await apiFetch<DetailWire>(`/api/admin/gift-cards/${id}`));
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      toast.error("Failed to load gift card", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const deltaCents = parseDollars(delta);

  async function adjust() {
    if (deltaCents === null || deltaCents === 0) {
      toast.error("Enter a non-zero adjustment");
      return;
    }
    if (!note.trim()) {
      toast.error("A note is required for adjustments");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/gift-cards/${id}`, {
        method: "PATCH",
        body: { action: "adjust", delta: deltaCents, note: note.trim() },
      });
      toast.success("Balance adjusted");
      setDelta("");
      setNote("");
      await loadDetail();
      onChanged();
    } catch (err) {
      toast.error("Adjustment failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function setCardStatus(action: "disable" | "enable") {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/gift-cards/${id}`, { method: "PATCH", body: { action } });
      toast.success(action === "disable" ? "Gift card disabled" : "Gift card enabled");
      await loadDetail();
      onChanged();
    } catch (err) {
      toast.error("Update failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  const resulting = detail && deltaCents !== null ? detail.balance + deltaCents : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gift card</DialogTitle>
          <DialogDescription>Full code, balance ledger and manual adjustments.</DialogDescription>
        </DialogHeader>

        {!detail ? (
          loadFailed ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">Couldn't load this gift card.</p>
              <Button variant="outline" onClick={() => void loadDetail()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
              <code className="flex-1 font-mono text-sm font-semibold tracking-wide break-all">
                {detail.code}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy code"
                onClick={() => void copyCode(detail.code)}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-muted-foreground">Balance</p>
                <p className="font-medium tabular-nums">
                  {formatMoney(detail.balance, detail.currency)}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    / {formatMoney(detail.initialBalance, detail.currency)}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <StatusBadge status={detail.status} />
              </div>
              <div>
                <p className="text-muted-foreground">Customer</p>
                <p>{detail.customerEmail ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Expires</p>
                <p>{detail.expiresAt ? formatDate(detail.expiresAt) : "Never"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p>{formatDate(detail.createdAt)}</p>
              </div>
            </div>

            {canUpdate ? (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">Adjust balance</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="adjust-delta">Amount ({detail.currency}, ± allowed)</Label>
                      <Input
                        id="adjust-delta"
                        type="number"
                        step={0.01}
                        value={delta}
                        onChange={(e) => setDelta(e.target.value)}
                        placeholder="e.g. 10.00 or -5.00"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="adjust-note">Note</Label>
                      <Input
                        id="adjust-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                        placeholder="e.g. Goodwill credit, in-store use"
                      />
                    </div>
                  </div>
                  {resulting !== null && deltaCents !== 0 ? (
                    <p
                      className={`text-sm ${resulting < 0 ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      New balance: {formatMoney(Math.max(resulting, 0), detail.currency)}
                      {resulting < 0 ? " — the balance can't go negative" : ""}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      onClick={adjust}
                      disabled={
                        saving ||
                        deltaCents === null ||
                        deltaCents === 0 ||
                        (resulting !== null && resulting < 0) ||
                        !note.trim()
                      }
                    >
                      Apply adjustment
                    </Button>
                    {detail.status === "disabled" ? (
                      <Button
                        variant="outline"
                        disabled={saving}
                        onClick={() => void setCardStatus("enable")}
                      >
                        Enable card
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="text-destructive"
                        disabled={saving}
                        onClick={() => setConfirmDisable(true)}
                      >
                        Disable card
                      </Button>
                    )}
                  </div>
                </div>
              </>
            ) : null}

            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">Ledger</p>
              {detail.transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transactions yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.transactions.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(tx.createdAt)}
                          </TableCell>
                          <TableCell>{tx.note ?? "—"}</TableCell>
                          <TableCell
                            className={`text-right font-medium tabular-nums ${
                              tx.delta < 0 ? "text-destructive" : "text-emerald-600"
                            }`}
                          >
                            {tx.delta > 0 ? "+" : ""}
                            {formatMoney(tx.delta, detail.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title="Disable this gift card?"
        description="The code will stop validating at checkout until you enable it again. The balance is kept."
        confirmLabel="Disable"
        onConfirm={() => void setCardStatus("disable")}
      />
    </Dialog>
  );
}
