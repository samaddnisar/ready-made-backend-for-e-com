import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Abandoned carts" };

export default async function Page() {
  if (!(await isFeatureEnabled("abandoned_cart"))) notFound();
  await requireReadPage("abandoned_carts");
  return <PagePlaceholder title={"Abandoned carts"} description={"Carts that never checked out, with reminder status."} phase={8} />;
}
