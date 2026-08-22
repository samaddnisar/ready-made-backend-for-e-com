import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { ContentClient } from "./content-client";

export const metadata: Metadata = { title: "Blog / CMS" };

export default async function ContentPage() {
  if (!(await isFeatureEnabled("cms"))) notFound();
  const admin = await requireReadPage("cms");
  const canCreate = can(admin, "cms", "create");
  const canWrite = can(admin, "cms", "update");
  const canDelete = can(admin, "cms", "delete");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blog / CMS"
        description="Blog posts and content pages with SEO fields. Drafts stay hidden from the storefront until published."
      />
      <ContentClient canCreate={canCreate} canWrite={canWrite} canDelete={canDelete} />
    </div>
  );
}
