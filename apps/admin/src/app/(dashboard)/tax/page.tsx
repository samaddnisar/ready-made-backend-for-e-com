import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { TaxClient } from "./tax-client";

export const metadata: Metadata = { title: "Tax" };

export default async function TaxPage() {
  const admin = await requireReadPage("tax");
  const canWrite = can(admin, "tax", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax"
        description="How checkout computes tax: none, a single flat rate, or Stripe Tax (per-client add-on)."
      />
      <TaxClient canWrite={canWrite} />
    </div>
  );
}
