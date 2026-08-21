import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Discounts" };

export default async function Page() {
  await requireReadPage("discounts");
  return <PagePlaceholder title={"Discounts"} description={"Discount codes with stacking rules and usage tracking."} phase={5} />;
}
