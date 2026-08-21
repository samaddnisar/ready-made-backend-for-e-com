import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <PagePlaceholder
      title="Dashboard"
      description="Revenue, orders, AOV, top products, low-stock alerts and recent orders with a date-range filter."
      phase={7}
    />
  );
}
