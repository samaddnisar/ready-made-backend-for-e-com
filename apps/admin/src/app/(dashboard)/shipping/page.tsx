import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Shipping" };

export default async function Page() {
  await requireReadPage("shipping");
  return <PagePlaceholder title={"Shipping"} description={"Shipping zones, rates and methods."} phase={5} />;
}
