"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";

/** Serialized (JSON) shapes of core's ZoneWithRates — dates arrive as strings. */
type RateType = "flat" | "weight" | "price";

type Rate = {
  id: string;
  zoneId: string;
  name: string;
  type: RateType;
  price: number;
  minCondition: number | null;
  maxCondition: number | null;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

type Zone = {
  id: string;
  name: string;
  countries: string[];
  createdAt: string;
  updatedAt: string;
  rates: Rate[];
};

const RATE_TYPE_LABELS: Record<RateType, string> = {
  flat: "Flat",
  weight: "By weight",
  price: "By price",
};

/** 500 → "500g", 1000 → "1kg", 1500 → "1.5kg". */
function formatWeight(grams: number): string {
  if (grams >= 1000) {
    const kg = grams / 1000;
    return `${Number.parseFloat(kg.toFixed(2))}kg`;
  }
  return `${grams}g`;
}

/** Condition column: "—" for flat, "500g – 2kg", "up to $50.00", "from 1kg". */
function formatCondition(rate: Rate, currency: string): string {
  if (rate.type === "flat") return "—";
  const fmt =
    rate.type === "weight" ? formatWeight : (v: number) => formatMoney(v, currency);
  const { minCondition: min, maxCondition: max } = rate;
  if (min === null && max === null) return "—";
  if (min !== null && max !== null) return `${fmt(min)} – ${fmt(max)}`;
  if (max !== null) return `up to ${fmt(max)}`;
  return `from ${fmt(min as number)}`;
}

export function ShippingClient({
  currency,
  canWrite,
}: {
  currency: string;
  canWrite: boolean;
}) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [zoneDialog, setZoneDialog] = useState<{ zone: Zone | null } | null>(null);
  const [rateDialog, setRateDialog] = useState<{ zone: Zone; rate: Rate | null } | null>(null);
  const [deletingZone, setDeletingZone] = useState<Zone | null>(null);
  const [deletingRate, setDeletingRate] = useState<Rate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setZones(await apiFetch<Zone[]>("/api/admin/shipping/zones"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteZone(zone: Zone) {
    try {
      await apiFetch(`/api/admin/shipping/zones/${zone.id}`, { method: "DELETE" });
      toast.success("Zone deleted");
      void load();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setDeletingZone(null);
    }
  }

  async function deleteRate(rate: Rate) {
    try {
      await apiFetch(`/api/admin/shipping/rates/${rate.id}`, { method: "DELETE" });
      toast.success("Rate deleted");
      void load();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setDeletingRate(null);
    }
  }

  if (loading && !zones) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (error && !zones) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="font-medium">Failed to load shipping zones</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const list = zones ?? [];

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button onClick={() => setZoneDialog({ zone: null })}>
            <Plus className="size-4" aria-hidden />
            Add zone
          </Button>
        </div>
      ) : null}

      {list.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No shipping zones yet"
          description="Zones map destination countries to the rates offered at checkout. Create a zone (e.g. Domestic, Europe, Rest of world), then add flat, weight-based or price-based rates to it."
          action={
            canWrite ? (
              <Button onClick={() => setZoneDialog({ zone: null })}>
                <Plus className="size-4" aria-hidden />
                Add zone
              </Button>
            ) : undefined
          }
        />
      ) : (
        list.map((zone) => (
          <Card key={zone.id}>
            <CardHeader>
              <CardTitle>{zone.name}</CardTitle>
              <CardDescription>
                <span className="mt-1 flex flex-wrap gap-1">
                  {zone.countries.map((code) => (
                    <Badge key={code} variant={code === "*" ? "secondary" : "outline"}>
                      {code === "*" ? "Rest of world" : code}
                    </Badge>
                  ))}
                </span>
              </CardDescription>
              {canWrite ? (
                <CardAction className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit zone ${zone.name}`}
                    onClick={() => setZoneDialog({ zone })}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete zone ${zone.name}`}
                    onClick={() => setDeletingZone(zone)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {zone.rates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rates yet — this zone offers nothing at checkout.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Active</TableHead>
                        {canWrite ? <TableHead className="w-20" /> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {zone.rates.map((rate) => (
                        <TableRow key={rate.id}>
                          <TableCell className="font-medium">{rate.name}</TableCell>
                          <TableCell>{RATE_TYPE_LABELS[rate.type]}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatCondition(rate, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rate.price === 0 ? "Free" : formatMoney(rate.price, currency)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-block size-2 rounded-full",
                                rate.isActive ? "bg-emerald-500" : "bg-muted-foreground/30",
                              )}
                              aria-hidden
                            />
                            <span className="sr-only">
                              {rate.isActive ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                          {canWrite ? (
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Edit rate ${rate.name}`}
                                  onClick={() => setRateDialog({ zone, rate })}
                                >
                                  <Pencil className="size-4" aria-hidden />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete rate ${rate.name}`}
                                  onClick={() => setDeletingRate(rate)}
                                >
                                  <Trash2 className="size-4" aria-hidden />
                                </Button>
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {canWrite ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRateDialog({ zone, rate: null })}
                >
                  <Plus className="size-4" aria-hidden />
                  Add rate
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}

      {zoneDialog ? (
        <ZoneDialog
          zone={zoneDialog.zone}
          onClose={() => setZoneDialog(null)}
          onSaved={load}
        />
      ) : null}
      {rateDialog ? (
        <RateDialog
          zone={rateDialog.zone}
          rate={rateDialog.rate}
          currency={currency}
          onClose={() => setRateDialog(null)}
          onSaved={load}
        />
      ) : null}

      <ConfirmDialog
        open={deletingZone !== null}
        onOpenChange={(open) => !open && setDeletingZone(null)}
        title={`Delete zone "${deletingZone?.name ?? ""}"?`}
        description={
          deletingZone
            ? `This deletes the zone and all ${deletingZone.rates.length} of its rate${
                deletingZone.rates.length === 1 ? "" : "s"
              }. Customers in these countries will have no shipping options at checkout.`
            : ""
        }
        onConfirm={() => {
          if (deletingZone) void deleteZone(deletingZone);
        }}
      />
      <ConfirmDialog
        open={deletingRate !== null}
        onOpenChange={(open) => !open && setDeletingRate(null)}
        title={`Delete rate "${deletingRate?.name ?? ""}"?`}
        description="This shipping rate will no longer be offered at checkout."
        onConfirm={() => {
          if (deletingRate) void deleteRate(deletingRate);
        }}
      />
    </div>
  );
}

// ── Zone create/edit ─────────────────────────────────────────

function ZoneDialog({
  zone,
  onClose,
  onSaved,
}: {
  zone: Zone | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [codes, setCodes] = useState<string[]>(
    zone ? zone.countries.filter((c) => c !== "*") : [],
  );
  const [restOfWorld, setRestOfWorld] = useState(zone?.countries.includes("*") ?? false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function addTokens(raw: string) {
    const tokens = raw
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (tokens.length === 0) return;
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const token of tokens) {
      if (token === "*") {
        setRestOfWorld(true);
      } else if (/^[A-Z]{2}$/.test(token)) {
        valid.push(token);
      } else {
        invalid.push(token);
      }
    }
    if (invalid.length > 0) {
      toast.error(`Not a 2-letter country code: ${invalid.join(", ")}`);
    }
    setCodes((prev) => [...prev, ...valid.filter((v) => !prev.includes(v))]);
    setDraft("");
  }

  async function save() {
    const countries = [...codes, ...(restOfWorld ? ["*"] : [])];
    if (!name.trim()) {
      toast.error("Zone name is required");
      return;
    }
    if (countries.length === 0) {
      toast.error("Add at least one country, or check Rest of world");
      return;
    }
    setSaving(true);
    try {
      const body = { name: name.trim(), countries };
      if (zone) {
        await apiFetch(`/api/admin/shipping/zones/${zone.id}`, { method: "PATCH", body });
        toast.success("Zone updated");
      } else {
        await apiFetch("/api/admin/shipping/zones", { method: "POST", body });
        toast.success("Zone created");
      }
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
          <DialogTitle>{zone ? "Edit zone" : "Add zone"}</DialogTitle>
          <DialogDescription>
            A zone lists the destination countries its rates apply to.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input
              id="zone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Domestic, Europe"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zone-countries">Countries</Label>
            {codes.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {codes.map((code) => (
                  <Badge key={code} variant="outline" className="gap-1 pr-1">
                    {code}
                    <button
                      type="button"
                      aria-label={`Remove ${code}`}
                      className="rounded-sm hover:bg-muted"
                      onClick={() => setCodes((prev) => prev.filter((c) => c !== code))}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
            <Input
              id="zone-countries"
              value={draft}
              onChange={(e) => {
                const value = e.target.value;
                if (/[\s,]/.test(value)) addTokens(value);
                else setDraft(value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTokens(draft);
                }
              }}
              onBlur={() => addTokens(draft)}
              placeholder="2-letter codes, e.g. US, CA, GB"
            />
            <p className="text-sm text-muted-foreground">
              Separate ISO codes with commas or spaces.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="zone-row"
              checked={restOfWorld}
              onCheckedChange={(v) => setRestOfWorld(v === true)}
            />
            <Label htmlFor="zone-row">Rest of world</Label>
          </div>
          {restOfWorld ? (
            <p className="text-sm text-muted-foreground">
              This zone also catches any country no other zone lists explicitly.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {zone ? "Save changes" : "Create zone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rate create/edit ─────────────────────────────────────────

/** "12.34" dollars → 1234 cents; null when blank; NaN propagates for validation. */
function dollarsToCents(value: string): number | null {
  if (value.trim() === "") return null;
  return Math.round(Number.parseFloat(value) * 100);
}

function RateDialog({
  zone,
  rate,
  currency,
  onClose,
  onSaved,
}: {
  zone: Zone;
  rate: Rate | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rate?.name ?? "");
  const [type, setType] = useState<RateType>(rate?.type ?? "flat");
  const [price, setPrice] = useState(rate ? (rate.price / 100).toFixed(2) : "");
  const [min, setMin] = useState(() => {
    if (!rate || rate.minCondition === null) return "";
    return rate.type === "price" ? (rate.minCondition / 100).toFixed(2) : String(rate.minCondition);
  });
  const [max, setMax] = useState(() => {
    if (!rate || rate.maxCondition === null) return "";
    return rate.type === "price" ? (rate.maxCondition / 100).toFixed(2) : String(rate.maxCondition);
  });
  const [isActive, setIsActive] = useState(rate?.isActive ?? true);
  const [position, setPosition] = useState(rate ? String(rate.position) : "0");
  const [saving, setSaving] = useState(false);

  function switchType(next: RateType) {
    if (next !== type) {
      setMin("");
      setMax("");
    }
    setType(next);
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Rate name is required");
      return;
    }
    const priceCents = dollarsToCents(price || "0");
    if (priceCents === null || Number.isNaN(priceCents) || priceCents < 0) {
      toast.error("Price must be a non-negative amount (0 = free)");
      return;
    }
    let minCondition: number | null = null;
    let maxCondition: number | null = null;
    if (type === "weight") {
      minCondition = min.trim() === "" ? null : Number.parseInt(min, 10);
      maxCondition = max.trim() === "" ? null : Number.parseInt(max, 10);
    } else if (type === "price") {
      minCondition = dollarsToCents(min);
      maxCondition = dollarsToCents(max);
    }
    const badBound = (v: number | null) => v !== null && (Number.isNaN(v) || v < 0);
    if (badBound(minCondition) || badBound(maxCondition)) {
      toast.error("Conditions must be non-negative numbers");
      return;
    }
    if (minCondition !== null && maxCondition !== null && minCondition > maxCondition) {
      toast.error("Max condition must be ≥ min");
      return;
    }
    const parsedPosition = Number.parseInt(position || "0", 10);
    if (Number.isNaN(parsedPosition) || parsedPosition < 0) {
      toast.error("Position must be a non-negative integer");
      return;
    }

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        type,
        price: priceCents,
        minCondition,
        maxCondition,
        isActive,
        position: parsedPosition,
      };
      if (rate) {
        await apiFetch(`/api/admin/shipping/rates/${rate.id}`, { method: "PATCH", body });
        toast.success("Rate updated");
      } else {
        await apiFetch(`/api/admin/shipping/zones/${zone.id}/rates`, { method: "POST", body });
        toast.success("Rate created");
      }
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

  const conditionUnit = type === "weight" ? "grams" : currency;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rate ? "Edit rate" : "Add rate"}</DialogTitle>
          <DialogDescription>Zone: {zone.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rate-name">Name</Label>
            <Input
              id="rate-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard, Express"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => switchType(v as RateType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="weight">By weight</SelectItem>
                  <SelectItem value="price">By price</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-price">Price</Label>
              <Input
                id="rate-price"
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-sm text-muted-foreground">0 = free shipping.</p>
            </div>
          </div>
          {type !== "flat" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rate-min">
                  Min {type === "weight" ? "weight" : "subtotal"} ({conditionUnit})
                </Label>
                <Input
                  id="rate-min"
                  type="number"
                  min={0}
                  step={type === "weight" ? 1 : "0.01"}
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  placeholder="No minimum"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-max">
                  Max {type === "weight" ? "weight" : "subtotal"} ({conditionUnit})
                </Label>
                <Input
                  id="rate-max"
                  type="number"
                  min={0}
                  step={type === "weight" ? 1 : "0.01"}
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  placeholder="No maximum"
                />
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="rate-active">Active</Label>
              <p className="text-sm text-muted-foreground">
                Inactive rates are hidden at checkout.
              </p>
            </div>
            <Switch id="rate-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-position">Position</Label>
            <Input
              id="rate-position"
              type="number"
              min={0}
              step={1}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Advanced: sort order at checkout (lower first). Leave 0 unless you care.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {rate ? "Save changes" : "Create rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
