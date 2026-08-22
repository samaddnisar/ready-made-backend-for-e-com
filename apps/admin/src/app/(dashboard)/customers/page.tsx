import type { Metadata } from "next";
import { getSettings } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { CustomersTable } from "./customers-table";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const admin = await requireReadPage("customers");
  const settings = await getSettings();
  const canWrite = can(admin, "customers", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Search customers, see order counts and lifetime value, and open a customer for details."
      />
      <CustomersTable currency={settings.currency} canWrite={canWrite} />
    </div>
  );
}
