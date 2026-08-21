import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Newsletter" };

export default async function Page() {
  if (!(await isFeatureEnabled("newsletter"))) notFound();
  await requireReadPage("newsletter");
  return <PagePlaceholder title={"Newsletter"} description={"Newsletter subscriber list."} phase={8} />;
}
