import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings, isFeatureEnabled } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { GiftCardsClient } from "./gift-cards-client";

export const metadata: Metadata = { title: "Gift cards" };

export default async function GiftCardsPage() {
  if (!(await isFeatureEnabled("gift_cards"))) notFound();
  const admin = await requireReadPage("gift_cards");
  const settings = await getSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gift cards"
        description="Issue gift cards, follow every balance change in the ledger, and disable lost or compromised codes."
      />
      <GiftCardsClient
        currency={settings.currency}
        canCreate={can(admin, "gift_cards", "create")}
        canUpdate={can(admin, "gift_cards", "update")}
      />
    </div>
  );
}
