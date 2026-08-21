import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@repo/core";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Gift cards" };

export default async function Page() {
  if (!(await isFeatureEnabled("gift_cards"))) notFound();
  await requireReadPage("gift_cards");
  return <PagePlaceholder title={"Gift cards"} description={"Issue gift cards and track balances."} phase={8} />;
}
