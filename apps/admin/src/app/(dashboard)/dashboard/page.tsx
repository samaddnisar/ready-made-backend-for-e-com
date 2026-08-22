import type { Metadata } from "next";
import { getSettings } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { requireReadPage } from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireReadPage("dashboard");
  const settings = await getSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Revenue, orders and average order value for the selected period, with top products, low-stock alerts and recent orders."
      />
      <DashboardClient currency={settings.currency} />
    </div>
  );
}
