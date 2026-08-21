import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Blog / CMS" };

export default async function Page() {
  if (!(await isFeatureEnabled("cms"))) notFound();
  await requireReadPage("cms");
  return <PagePlaceholder title={"Blog / CMS"} description={"Blog posts and content pages with SEO fields."} phase={8} />;
}
