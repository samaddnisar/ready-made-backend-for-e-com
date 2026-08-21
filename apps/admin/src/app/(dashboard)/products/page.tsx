import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getSettings } from "@repo/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { can, requireReadPage } from "@/lib/auth";
import { ProductsTable } from "./products-table";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  const admin = await requireReadPage("products");
  const settings = await getSettings();
  const canWrite = can(admin, "products", "create");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Manage your catalog: variants, images, categories, collections and publishing."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/products/new">
                <Plus className="size-4" aria-hidden />
                New product
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ProductsTable currency={settings.currency} canWrite={canWrite} />
    </div>
  );
}
