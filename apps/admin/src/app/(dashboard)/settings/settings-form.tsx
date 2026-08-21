"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  type FeatureFlags,
  type FeatureKey,
} from "@repo/core/flags";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

type SettingsInitial = {
  storeName: string;
  storeEmail: string | null;
  storePhone: string | null;
  currency: string;
  logoUrl: string | null;
  featureFlags: FeatureFlags;
};

const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  reviews: "Customers can leave ratings; you moderate them before they go live.",
  wishlists: "Customers can save products to wishlists.",
  gift_cards: "Sell and redeem gift-card codes at checkout.",
  loyalty: "Customers earn points on orders and redeem them.",
  cms: "Blog posts and content pages served to the storefront.",
  abandoned_cart: "Track abandoned carts and send recovery reminders.",
  related_products: "Serve related/recommended products on product pages.",
  newsletter: "Collect newsletter signups from the storefront.",
};

export function SettingsForm({
  initial,
  canEdit,
}: {
  initial: SettingsInitial;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [store, setStore] = useState({
    storeName: initial.storeName,
    storeEmail: initial.storeEmail ?? "",
    storePhone: initial.storePhone ?? "",
    currency: initial.currency,
    logoUrl: initial.logoUrl ?? "",
  });
  const [flags, setFlags] = useState<FeatureFlags>(initial.featureFlags);

  async function patch(body: unknown, successMessage: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? "Request failed");
      }
      toast.success(successMessage);
      router.refresh();
      return true;
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Something went wrong",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveStoreInfo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await patch(
      {
        storeName: store.storeName,
        storeEmail: store.storeEmail || null,
        storePhone: store.storePhone || null,
        currency: store.currency.toUpperCase(),
        logoUrl: store.logoUrl || null,
      },
      "Store settings saved",
    );
  }

  async function toggleFeature(key: FeatureKey, enabled: boolean) {
    const previous = flags;
    setFlags({ ...flags, [key]: enabled });
    const okay = await patch(
      { featureFlags: { [key]: enabled } },
      `${FEATURE_LABELS[key]} ${enabled ? "enabled" : "disabled"}`,
    );
    if (!okay) setFlags(previous);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Store information</CardTitle>
          <CardDescription>Shown to customers and used in emails.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveStoreInfo} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="storeName">Store name</Label>
              <Input
                id="storeName"
                value={store.storeName}
                onChange={(e) => setStore({ ...store, storeName: e.target.value })}
                disabled={!canEdit}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="storeEmail">Support email</Label>
                <Input
                  id="storeEmail"
                  type="email"
                  value={store.storeEmail}
                  onChange={(e) => setStore({ ...store, storeEmail: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="storePhone">Phone</Label>
                <Input
                  id="storePhone"
                  value={store.storePhone}
                  onChange={(e) => setStore({ ...store, storePhone: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency (ISO 4217)</Label>
                <Input
                  id="currency"
                  value={store.currency}
                  onChange={(e) => setStore({ ...store, currency: e.target.value })}
                  maxLength={3}
                  disabled={!canEdit}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  value={store.logoUrl}
                  onChange={(e) => setStore({ ...store, logoUrl: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>
            <Button type="submit" disabled={saving || !canEdit}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save store info
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature toggles</CardTitle>
          <CardDescription>
            Disabled features are hidden here and their API endpoints return 404.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {FEATURE_KEYS.map((key, i) => (
            <div key={key}>
              {i > 0 ? <Separator /> : null}
              <div className="flex items-center justify-between gap-4 py-3">
                <div className="space-y-0.5">
                  <Label htmlFor={`feature-${key}`}>{FEATURE_LABELS[key]}</Label>
                  <p className="text-sm text-muted-foreground">{FEATURE_DESCRIPTIONS[key]}</p>
                </div>
                <Switch
                  id={`feature-${key}`}
                  checked={flags[key]}
                  onCheckedChange={(v) => toggleFeature(key, v)}
                  disabled={saving || !canEdit}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
