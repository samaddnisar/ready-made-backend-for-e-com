import type { Metadata } from "next";
import { getSettings, normalizeFlags } from "@repo/core";
import { can, requireReadPage } from "@/lib/auth";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const admin = await requireReadPage("settings");
  const settings = await getSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Store information and feature toggles. Toggles take effect immediately — no redeploy.
        </p>
      </div>
      <SettingsForm
        initial={{
          storeName: settings.storeName,
          storeEmail: settings.storeEmail,
          storePhone: settings.storePhone,
          currency: settings.currency,
          logoUrl: settings.logoUrl,
          featureFlags: normalizeFlags(settings.featureFlags),
        }}
        canEdit={can(admin, "settings", "update")}
      />
    </div>
  );
}
