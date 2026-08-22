import type { Metadata } from "next";
import { getSettings } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { ShippingClient } from "./shipping-client";

export const metadata: Metadata = { title: "Shipping" };

export default async function ShippingPage() {
  const admin = await requireReadPage("shipping");
  const settings = await getSettings();
  const canWrite = can(admin, "shipping", "create");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping"
        description="Zones group destination countries; each zone offers flat, weight-based or price-based rates at checkout."
      />
      <ShippingClient currency={settings.currency} canWrite={canWrite} />
    </div>
  );
}
