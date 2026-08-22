"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

type TaxMode = "none" | "flat" | "stripe_tax";

/** Serialized shape of core's TaxSettings — dates arrive as strings. */
type TaxSettings = {
  id: number;
  mode: TaxMode;
  rateBps: number;
  pricesIncludeTax: boolean;
  createdAt: string;
  updatedAt: string;
};

export function TaxClient({ canWrite }: { canWrite: boolean }) {
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<TaxMode>("none");
  const [ratePercent, setRatePercent] = useState("");
  const [pricesIncludeTax, setPricesIncludeTax] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TaxSettings>("/api/admin/tax");
      setSettings(data);
      setMode(data.mode);
      setRatePercent(data.rateBps === 0 ? "" : String(data.rateBps / 100));
      setPricesIncludeTax(data.pricesIncludeTax);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const body: { mode: TaxMode; rateBps?: number; pricesIncludeTax?: boolean } = { mode };
    if (mode === "flat") {
      const rateBps = Math.round(Number.parseFloat(ratePercent || "0") * 100);
      if (Number.isNaN(rateBps) || rateBps < 0 || rateBps > 10_000) {
        toast.error("Rate must be between 0 and 100 percent");
        return;
      }
      body.rateBps = rateBps;
      body.pricesIncludeTax = pricesIncludeTax;
    }
    setSaving(true);
    try {
      const data = await apiFetch<TaxSettings>("/api/admin/tax", { method: "PATCH", body });
      setSettings(data);
      setMode(data.mode);
      setRatePercent(data.rateBps === 0 ? "" : String(data.rateBps / 100));
      setPricesIncludeTax(data.pricesIncludeTax);
      toast.success("Tax settings saved");
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return <Skeleton className="h-64 w-full max-w-2xl" />;
  }

  if (error && !settings) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="font-medium">Failed to load tax settings</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Tax calculation</CardTitle>
        <CardDescription>Applied to every order at checkout.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as TaxMode)}
            disabled={!canWrite}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None — no tax charged</SelectItem>
              <SelectItem value="flat">Flat rate — one rate for all orders</SelectItem>
              <SelectItem value="stripe_tax" disabled>
                <span className="flex flex-col items-start">
                  <span>Stripe Tax</span>
                  <span className="text-xs text-muted-foreground">
                    Architectural add-on — wired per client, not a toggle (see spec §4)
                  </span>
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "flat" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="tax-rate">Rate (%)</Label>
              <Input
                id="tax-rate"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
                placeholder="e.g. 8.25"
                disabled={!canWrite}
                className="max-w-40"
              />
              <p className="text-sm text-muted-foreground">
                Decimals allowed — 8.25 means 8.25% on the taxable total.
              </p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="tax-inclusive">Prices include tax</Label>
                <p className="text-sm text-muted-foreground">
                  Prices already include tax — checkout extracts it instead of adding it.
                </p>
              </div>
              <Switch
                id="tax-inclusive"
                checked={pricesIncludeTax}
                onCheckedChange={setPricesIncludeTax}
                disabled={!canWrite}
              />
            </div>
          </>
        ) : null}
      </CardContent>
      {canWrite ? (
        <CardFooter>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
