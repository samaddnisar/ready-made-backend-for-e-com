import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Media library" };

export default async function Page() {
  await requireReadPage("media");
  return <PagePlaceholder title={"Media library"} description={"Uploaded assets, browsable and reusable across products and content."} phase={2} />;
}
