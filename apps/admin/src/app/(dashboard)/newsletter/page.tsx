import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { isFeatureEnabled } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireReadPage } from "@/lib/auth";
import { NewsletterClient } from "./newsletter-client";

export const metadata: Metadata = { title: "Newsletter" };

export default async function NewsletterPage() {
  if (!(await isFeatureEnabled("newsletter"))) notFound();
  await requireReadPage("newsletter");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Newsletter"
        description="Subscribers collected from the storefront — search, filter by status, and export active emails."
        actions={
          <Button asChild variant="outline">
            {/* Plain <a>: a file download, not a fetch — the browser follows
                the Content-Disposition header from the export route. */}
            <a href="/api/admin/newsletter/export">
              <Download className="size-4" aria-hidden />
              Export CSV
            </a>
          </Button>
        }
      />
      <NewsletterClient />
    </div>
  );
}
