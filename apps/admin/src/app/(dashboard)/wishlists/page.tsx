import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Wishlists" };

export default async function Page() {
  if (!(await isFeatureEnabled("wishlists"))) notFound();
  await requireReadPage("wishlists");
  return <PagePlaceholder title={"Wishlists"} description={"Read view of customers' wishlists."} phase={8} />;
}
