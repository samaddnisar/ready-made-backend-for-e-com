import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Reviews" };

export default async function Page() {
  if (!(await isFeatureEnabled("reviews"))) notFound();
  await requireReadPage("reviews");
  return <PagePlaceholder title={"Reviews"} description={"Moderation queue for customer reviews and ratings."} phase={8} />;
}
