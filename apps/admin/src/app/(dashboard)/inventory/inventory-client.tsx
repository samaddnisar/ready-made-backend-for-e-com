"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, MoreHorizontal, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";

type InventoryRow = {
  inventoryId: string;
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  reservedQty: number;
  available: number;
  lowStockThreshold: number | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  updatedAt: string;
};

type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

type Adjustment = {
  id: string;
  delta: number;
  reason: string;
  createdAt: string;
};

export function InventoryClient({ canWrite }: { canWrite: boolean }) {
  const [data, setData] = useState<Paginated<InventoryRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [configuring, setConfiguring] = useState<InventoryRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (q) params.set("q", q);
      if (lowStockOnly) params.set("lowStockOnly", "true");
      setData(await apiFetch<Paginated<InventoryRow>>(`/api/admin/inventory?${params}`));
    } catch (err) {
      toast.error("Failed to load inventory", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [page, q, lowStockOnly]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [load, q]);

  const rows = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search product, variant or SKU…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <Switch
            id="low-stock-only"
            checked={lowStockOnly}
            onCheckedChange={(v) => {
              setLowStockOnly(v);
              setPage(1);
            }}
          />
          <Label htmlFor="low-stock-only">Low stock only</Label>
        </div>
      </div>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={lowStockOnly ? "Nothing is low on stock" : "No inventory records"}
          description={
            lowStockOnly
              ? "No tracked variant is at or below its low-stock threshold."
              : "Inventory rows are created automatically when you add product variants."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                {canWrite ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const low =
                  row.trackInventory &&
                  row.lowStockThreshold !== null &&
                  row.available <= row.lowStockThreshold;
                const out = row.trackInventory && row.available <= 0;
                return (
                  <TableRow key={row.inventoryId}>
                    <TableCell>
                      <div className="font-medium">{row.productTitle}</div>
                      {row.variantTitle ? (
                        <div className="text-sm text-muted-foreground">{row.variantTitle}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.sku ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.trackInventory ? row.quantity : "∞"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.trackInventory ? row.reservedQty : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.trackInventory ? row.available : "∞"}
                    </TableCell>
                    <TableCell>
                      {!row.trackInventory ? (
                        <Badge variant="outline">Untracked</Badge>
                      ) : out ? (
                        <Badge variant="destructive">Out of stock</Badge>
                      ) : low ? (
                        <Badge className="bg-amber-500 text-white hover:bg-amber-500">Low</Badge>
                      ) : (
                        <Badge variant="secondary">In stock</Badge>
                      )}
                      {row.allowBackorder ? (
                        <Badge variant="outline" className="ml-1">
                          Backorder
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.updatedAt)}</TableCell>
                    {canWrite ? (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Row actions">
                              <MoreHorizontal className="size-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setAdjusting(row)}>
                              Adjust stock
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setConfiguring(row)}>
                              <Settings2 className="size-4" aria-hidden />
                              Tracking settings
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
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

      {adjusting ? (
        <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} onSaved={load} />
      ) : null}
      {configuring ? (
        <ConfigDialog row={configuring} onClose={() => setConfiguring(null)} onSaved={load} />
      ) : null}
    </div>
  );
}

function AdjustDialog({
  row,
  onClose,
  onSaved,
}: {
  row: InventoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Adjustment[] | null>(null);

  useEffect(() => {
    apiFetch<{ adjustments: Adjustment[] }>(`/api/admin/inventory/${row.variantId}`)
      .then((r) => setHistory(r.adjustments))
      .catch(() => setHistory([]));
  }, [row.variantId]);

  const parsed = useMemo(() => Number.parseInt(delta, 10), [delta]);
  const resulting = Number.isNaN(parsed) ? null : row.quantity + parsed;

  async function save() {
    if (Number.isNaN(parsed) || parsed === 0 || !reason.trim()) {
      toast.error("Enter a non-zero adjustment and a reason");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/inventory/adjust`, {
        method: "POST",
        body: { variantId: row.variantId, delta: parsed, reason: reason.trim() },
      });
      toast.success("Stock adjusted");
      onSaved();
      onClose();
    } catch (err) {
      toast.error("Adjustment failed", {
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
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {row.productTitle}
            {row.variantTitle ? ` · ${row.variantTitle}` : ""} — currently {row.quantity} on hand.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adjust-delta">Adjustment (+ received, − removed)</Label>
            <Input
              id="adjust-delta"
              type="number"
              step={1}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 25 or -3"
            />
            {resulting !== null ? (
              <p className={`text-sm ${resulting < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                New on-hand quantity: {resulting}
                {resulting < 0 ? " — can't go negative" : ""}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-reason">Reason</Label>
            <Input
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Received shipment, damaged, recount"
            />
          </div>
          {history && history.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">Recent adjustments</p>
              <ul className="max-h-32 space-y-1 overflow-y-auto text-sm text-muted-foreground">
                {history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2">
                    <span className="truncate">{h.reason}</span>
                    <span className="shrink-0 tabular-nums">
                      {h.delta > 0 ? `+${h.delta}` : h.delta} · {formatDate(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || resulting === null || resulting < 0}>
            Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigDialog({
  row,
  onClose,
  onSaved,
}: {
  row: InventoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [trackInventory, setTrackInventory] = useState(row.trackInventory);
  const [allowBackorder, setAllowBackorder] = useState(row.allowBackorder);
  const [threshold, setThreshold] = useState(
    row.lowStockThreshold === null ? "" : String(row.lowStockThreshold),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsedThreshold = threshold.trim() === "" ? null : Number.parseInt(threshold, 10);
    if (parsedThreshold !== null && (Number.isNaN(parsedThreshold) || parsedThreshold < 0)) {
      toast.error("Threshold must be a non-negative number");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/inventory/${row.variantId}`, {
        method: "PATCH",
        body: { trackInventory, allowBackorder, lowStockThreshold: parsedThreshold },
      });
      toast.success("Tracking settings saved");
      onSaved();
      onClose();
    } catch (err) {
      toast.error("Save failed", {
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
          <DialogTitle>Tracking settings</DialogTitle>
          <DialogDescription>
            {row.productTitle}
            {row.variantTitle ? ` · ${row.variantTitle}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="cfg-track">Track inventory</Label>
              <p className="text-sm text-muted-foreground">
                Untracked variants are always purchasable.
              </p>
            </div>
            <Switch id="cfg-track" checked={trackInventory} onCheckedChange={setTrackInventory} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="cfg-backorder">Allow backorders</Label>
              <p className="text-sm text-muted-foreground">Keep selling at zero stock.</p>
            </div>
            <Switch id="cfg-backorder" checked={allowBackorder} onCheckedChange={setAllowBackorder} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-threshold">Low-stock threshold</Label>
            <Input
              id="cfg-threshold"
              type="number"
              min={0}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Empty = no alert"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
