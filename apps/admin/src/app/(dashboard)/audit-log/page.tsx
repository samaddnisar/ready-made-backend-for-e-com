import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Audit log" };

export default async function Page() {
  await requireReadPage("audit_log");
  return <PagePlaceholder title={"Audit log"} description={"Who changed what, when \u2014 every admin mutation is recorded."} phase={9} />;
}
