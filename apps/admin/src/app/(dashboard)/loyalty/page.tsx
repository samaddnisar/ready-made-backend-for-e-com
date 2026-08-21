import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Loyalty" };

export default async function Page() {
  if (!(await isFeatureEnabled("loyalty"))) notFound();
  await requireReadPage("loyalty");
  return <PagePlaceholder title={"Loyalty"} description={"Customer point balances and the earning/redemption ledger."} phase={8} />;
}
