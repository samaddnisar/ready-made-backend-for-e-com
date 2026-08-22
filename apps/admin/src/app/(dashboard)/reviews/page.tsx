import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { ReviewsClient } from "./reviews-client";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  if (!(await isFeatureEnabled("reviews"))) notFound();
  const admin = await requireReadPage("reviews");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        description="Moderate customer reviews before they appear on the storefront: approve, reject, or remove them."
      />
      <ReviewsClient
        canModerate={can(admin, "reviews", "update")}
        canDelete={can(admin, "reviews", "delete")}
      />
    </div>
  );
}
