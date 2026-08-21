import type { Metadata } from "next";
import { can, requireReadPage } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { InventoryClient } from "./inventory-client";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const admin = await requireReadPage("inventory");
  const canWrite = can(admin, "inventory", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Stock levels across all variants. Available = on hand − reserved by active checkouts."
      />
      <InventoryClient canWrite={canWrite} />
    </div>
  );
}
