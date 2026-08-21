import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@repo/core";
import { can, requireReadPage } from "@/lib/auth";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const admin = await requireReadPage("products");
  if (!can(admin, "products", "create")) notFound();
  const settings = await getSettings();

  return <ProductForm mode="create" currency={settings.currency} />;
}
