import type { Metadata } from "next";
import { can, requireReadPage } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { OrdersTable } from "./orders-table";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage() {
  const admin = await requireReadPage("orders");
  const canWrite = can(admin, "orders", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Search, filter and open orders. Amounts are shown in each order's own currency."
      />
      <OrdersTable canWrite={canWrite} />
    </div>
  );
}
