import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Tax" };

export default async function Page() {
  await requireReadPage("tax");
  return <PagePlaceholder title={"Tax"} description={"Tax mode and rates: none, flat rate, or Stripe Tax."} phase={5} />;
}
