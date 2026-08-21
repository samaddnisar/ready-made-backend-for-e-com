import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireReadPage("dashboard");
  return (
    <PagePlaceholder
      title="Dashboard"
      description="Revenue, orders, AOV, top products, low-stock alerts and recent orders with a date-range filter."
      phase={7}
    />
  );
}
