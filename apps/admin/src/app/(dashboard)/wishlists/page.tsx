import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { requireReadPage } from "@/lib/auth";
import { WishlistsClient } from "./wishlists-client";

export const metadata: Metadata = { title: "Wishlists" };

export default async function WishlistsPage() {
  if (!(await isFeatureEnabled("wishlists"))) notFound();
  await requireReadPage("wishlists");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wishlists"
        description="Read view of customers' wishlists: totals and the most-saved products."
      />
      <WishlistsClient />
    </div>
  );
}
