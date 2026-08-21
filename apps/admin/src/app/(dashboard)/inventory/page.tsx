import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Inventory" };

export default async function Page() {
  await requireReadPage("inventory");
  return <PagePlaceholder title={"Inventory"} description={"Stock levels, low-stock view and adjustments with a reason."} phase={3} />;
}
