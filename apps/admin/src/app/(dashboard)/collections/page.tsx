import type { Metadata } from "next";
import { can, requireReadPage } from "@/lib/auth";
import { CollectionsClient } from "./collections-client";

export const metadata: Metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const admin = await requireReadPage("products");
  return <CollectionsClient canWrite={can(admin, "products", "update")} />;
}
