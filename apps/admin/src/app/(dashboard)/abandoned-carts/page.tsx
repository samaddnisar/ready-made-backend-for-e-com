import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { AbandonedCartsClient } from "./abandoned-carts-client";

export const metadata: Metadata = { title: "Abandoned carts" };

export default async function AbandonedCartsPage() {
  if (!(await isFeatureEnabled("abandoned_cart"))) notFound();
  const admin = await requireReadPage("abandoned_carts");
  const canDetect = can(admin, "abandoned_carts", "create");
  const canRemind = can(admin, "abandoned_carts", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abandoned carts"
        description="Carts that never checked out, with reminder status."
      />
      <AbandonedCartsClient canDetect={canDetect} canRemind={canRemind} />
    </div>
  );
}
