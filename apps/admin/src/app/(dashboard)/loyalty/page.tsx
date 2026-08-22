import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { LoyaltyClient } from "./loyalty-client";

export const metadata: Metadata = { title: "Loyalty" };

export default async function LoyaltyPage() {
  if (!(await isFeatureEnabled("loyalty"))) notFound();
  const admin = await requireReadPage("loyalty");
  const canAdjust = can(admin, "loyalty", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loyalty"
        description="Customer point balances and the earning ledger. Points accrue automatically when a signed-in customer's order is paid."
      />
      <LoyaltyClient canAdjust={canAdjust} />
    </div>
  );
}
