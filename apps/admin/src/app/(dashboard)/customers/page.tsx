import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Customers" };

export default async function Page() {
  await requireReadPage("customers");
  return <PagePlaceholder title={"Customers"} description={"Customer list, detail with order history, addresses and lifetime value."} phase={6} />;
}
