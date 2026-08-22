import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireReadPage } from "@/lib/auth";
import { AuditLogClient } from "./audit-log-client";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogPage() {
  await requireReadPage("audit_log");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Who changed what, when — every admin mutation is recorded."
      />
      <AuditLogClient />
    </div>
  );
}
