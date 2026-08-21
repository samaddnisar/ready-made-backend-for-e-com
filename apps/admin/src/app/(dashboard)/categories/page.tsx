import type { Metadata } from "next";
import { can, requireReadPage } from "@/lib/auth";
import { CategoriesClient } from "./categories-client";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const admin = await requireReadPage("products");
  return <CategoriesClient canWrite={can(admin, "products", "update")} />;
}
