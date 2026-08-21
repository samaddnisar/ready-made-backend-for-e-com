import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductById, getSettings, type ProductDetail } from "@repo/core";
import { AppError } from "@repo/core/errors";
import { uuidSchema } from "@repo/core/validation";
import { can, requireReadPage } from "@/lib/auth";
import { ProductForm, type ProductFormInitial } from "../product-form";

export const metadata: Metadata = { title: "Edit product" };

function toInitial(product: ProductDetail): ProductFormInitial {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    status: product.status,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    ogImageUrl: product.ogImageUrl,
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      optionValues: v.optionValues,
      weightGrams: v.weightGrams,
      barcode: v.barcode,
    })),
    images: product.images.map((img) => ({ url: img.url, alt: img.alt })),
    categoryIds: product.categoryIds,
    collectionIds: product.collectionIds,
  };
}

export default async function EditProductPage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const admin = await requireReadPage("products");
  if (!uuidSchema.safeParse(id).success) notFound();

  let product: ProductDetail;
  try {
    product = await getProductById(id);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }

  const settings = await getSettings();

  return (
    <ProductForm
      mode="edit"
      currency={settings.currency}
      initial={toInitial(product)}
      canWrite={can(admin, "products", "update")}
      canDelete={can(admin, "products", "delete")}
    />
  );
}
