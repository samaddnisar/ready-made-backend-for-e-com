import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Products" };

export default async function Page() {
  await requireReadPage("products");
  return <PagePlaceholder title={"Products"} description={"Product CRUD with variants, images, categories, collections, bulk actions and draft/publish."} phase={2} />;
}
