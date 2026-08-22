import type { Metadata } from "next";
import { getSettings } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { DiscountsClient } from "./discounts-client";

export const metadata: Metadata = { title: "Discounts" };

export default async function DiscountsPage() {
  const admin = await requireReadPage("discounts");
  const settings = await getSettings();
  const canWrite = can(admin, "discounts", "create");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discounts"
        description="Discount codes with stacking rules and usage tracking."
      />
      <DiscountsClient currency={settings.currency} canWrite={canWrite} />
    </div>
  );
}
