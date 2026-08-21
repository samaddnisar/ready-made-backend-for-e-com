"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, ImageIcon, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/client-api";
import { MediaPickerDialog } from "./image-picker";
import { VariantEditor, type VariantRow } from "./variant-editor";

// ── Types ────────────────────────────────────────────────────

export type ProductFormInitial = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  basePrice: number | null;
  baseCompareAtPrice: number | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  variants: {
    id: string;
    sku: string | null;
    title: string | null;
    price: number;
    compareAtPrice: number | null;
    optionValues: Record<string, string>;
    weightGrams: number | null;
    barcode: string | null;
  }[];
  images: { url: string; alt: string | null; variantId: string | null }[];
  categoryIds: string[];
  collectionIds: string[];
};

type CategoryOption = { id: string; name: string; parentId: string | null };
type CollectionOption = { id: string; name: string };
type ImageRow = { url: string; alt: string; variantId: string | null };

// ── Helpers ──────────────────────────────────────────────────

/** Client-side mirror of the server slugifier (server stays authoritative). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function centsToDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/** "12.34" → 1234; null when not a valid non-negative amount. */
function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (Array.isArray(err.details)) {
      const lines = err.details
        .map((detail) => {
          const item = detail as { path?: string; message?: string };
          return [item.path, item.message].filter(Boolean).join(": ");
        })
        .filter(Boolean);
      if (lines.length > 0) return lines.join("\n");
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

function initialVariantRows(initial?: ProductFormInitial): VariantRow[] {
  if (!initial || initial.variants.length === 0) {
    return [
      {
        key: "v0",
        sku: "",
        price: "",
        compareAtPrice: "",
        weightGrams: "",
        barcode: "",
        optionValues: {},
      },
    ];
  }
  return initial.variants.map((v, i) => ({
    key: `v${i}`,
    id: v.id,
    sku: v.sku ?? "",
    price: centsToDollars(v.price),
    compareAtPrice: centsToDollars(v.compareAtPrice),
    weightGrams: v.weightGrams === null ? "" : String(v.weightGrams),
    barcode: v.barcode ?? "",
    optionValues: v.optionValues,
  }));
}

/** Option names in first-seen order across the existing variants. */
function initialOptionNames(initial?: ProductFormInitial): string[] {
  const names: string[] = [];
  for (const variant of initial?.variants ?? []) {
    for (const name of Object.keys(variant.optionValues)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

// ── Component ────────────────────────────────────────────────

export function ProductForm({
  mode,
  currency,
  initial,
  canWrite = true,
  canDelete = false,
}: {
  mode: "create" | "edit";
  currency: string;
  initial?: ProductFormInitial;
  canWrite?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<ProductFormInitial["status"]>(initial?.status ?? "draft");
  const [basePrice, setBasePrice] = useState(centsToDollars(initial?.basePrice ?? null));
  const [baseCompareAtPrice, setBaseCompareAtPrice] = useState(
    centsToDollars(initial?.baseCompareAtPrice ?? null),
  );
  const [metaTitle, setMetaTitle] = useState(initial?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(initial?.metaDescription ?? "");
  const [ogImageUrl, setOgImageUrl] = useState(initial?.ogImageUrl ?? "");

  const [optionNames, setOptionNames] = useState<string[]>(() => initialOptionNames(initial));
  const [variants, setVariants] = useState<VariantRow[]>(() => initialVariantRows(initial));
  const [images, setImages] = useState<ImageRow[]>(
    () =>
      initial?.images.map((img) => ({
        url: img.url,
        alt: img.alt ?? "",
        variantId: img.variantId,
      })) ?? [],
  );

  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.categoryIds ?? []);
  const [collectionIds, setCollectionIds] = useState<string[]>(initial?.collectionIds ?? []);
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [collections, setCollections] = useState<CollectionOption[] | null>(null);

  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    apiFetch<CategoryOption[]>("/api/admin/categories")
      .then(setCategories)
      .catch((err: unknown) => {
        setCategories([]);
        toast.error("Failed to load categories", { description: describeError(err) });
      });
    apiFetch<CollectionOption[]>("/api/admin/collections")
      .then(setCollections)
      .catch((err: unknown) => {
        setCollections([]);
        toast.error("Failed to load collections", { description: describeError(err) });
      });
  }, []);

  /** Roots first, each followed by its direct children (one indent level). */
  const orderedCategories = useMemo(() => {
    if (!categories) return [];
    const ids = new Set(categories.map((c) => c.id));
    const children = new Map<string, CategoryOption[]>();
    for (const category of categories) {
      if (category.parentId && ids.has(category.parentId)) {
        const list = children.get(category.parentId) ?? [];
        list.push(category);
        children.set(category.parentId, list);
      }
    }
    const out: { category: CategoryOption; depth: number }[] = [];
    for (const category of categories) {
      if (category.parentId && ids.has(category.parentId)) continue;
      out.push({ category, depth: 0 });
      for (const child of children.get(category.id) ?? []) out.push({ category: child, depth: 1 });
    }
    return out;
  }, [categories]);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function toggleId(list: string[], id: string, checked: boolean): string[] {
    if (checked) return list.includes(id) ? list : [...list, id];
    return list.filter((item) => item !== id);
  }

  function moveImage(index: number, delta: -1 | 1) {
    setImages((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Title is required");
      return;
    }

    const basePriceCents = dollarsToCents(basePrice);
    if (basePrice.trim() !== "" && basePriceCents === null) {
      toast.error("Base price is invalid");
      return;
    }
    const baseCompareAtPriceCents = dollarsToCents(baseCompareAtPrice);
    if (baseCompareAtPrice.trim() !== "" && baseCompareAtPriceCents === null) {
      toast.error("Base compare-at price is invalid");
      return;
    }

    const variantPayloads = [];
    for (let i = 0; i < variants.length; i++) {
      const row = variants[i]!;
      const price = dollarsToCents(row.price);
      if (price === null) {
        toast.error(`Variant ${i + 1}: enter a valid price`);
        return;
      }
      const compareAtPrice =
        row.compareAtPrice.trim() === "" ? null : dollarsToCents(row.compareAtPrice);
      if (row.compareAtPrice.trim() !== "" && compareAtPrice === null) {
        toast.error(`Variant ${i + 1}: compare-at price is invalid`);
        return;
      }
      let weightGrams: number | null = null;
      if (row.weightGrams.trim() !== "") {
        const parsed = Number(row.weightGrams.trim());
        if (!Number.isInteger(parsed) || parsed < 0) {
          toast.error(`Variant ${i + 1}: weight must be a whole number of grams`);
          return;
        }
        weightGrams = parsed;
      }

      const optionValues: Record<string, string> = {};
      for (const name of optionNames) {
        const value = (row.optionValues[name] ?? "").trim();
        if (value) optionValues[name] = value;
      }
      const composedTitle = optionNames
        .map((name) => optionValues[name])
        .filter(Boolean)
        .join(" / ");

      variantPayloads.push({
        ...(row.id ? { id: row.id } : {}),
        sku: row.sku.trim() || null,
        title: composedTitle || null,
        price,
        compareAtPrice,
        optionValues,
        weightGrams,
        barcode: row.barcode.trim() || null,
        position: i,
      });
    }

    // Keys match createProductSchema / updateProductSchema exactly (strict).
    const payload = {
      title: trimmedTitle,
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      description: description.trim() ? description : null,
      status,
      basePrice: basePriceCents,
      baseCompareAtPrice: baseCompareAtPriceCents,
      variants: variantPayloads,
      images: images.map((img, i) => ({
        url: img.url,
        alt: img.alt.trim() ? img.alt.trim() : null,
        position: i,
        variantId: img.variantId,
      })),
      categoryIds,
      collectionIds,
      metaTitle: metaTitle.trim() ? metaTitle.trim() : null,
      metaDescription: metaDescription.trim() ? metaDescription.trim() : null,
      ogImageUrl: ogImageUrl.trim() ? ogImageUrl.trim() : null,
    };

    setSaving(true);
    try {
      if (mode === "create") {
        await apiFetch("/api/admin/products", { method: "POST", body: payload });
        toast.success("Product created");
      } else {
        await apiFetch(`/api/admin/products/${initial!.id}`, { method: "PATCH", body: payload });
        toast.success("Product saved");
      }
      router.push("/products");
      router.refresh();
    } catch (err) {
      toast.error("Save failed", { description: describeError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await apiFetch<{ deleted: boolean }>(`/api/admin/products/${initial!.id}`, {
        method: "DELETE",
      });
      toast.success("Product deleted");
      router.push("/products");
      router.refresh();
    } catch (err) {
      toast.error("Delete failed", { description: describeError(err) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Products
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "create" ? "New product" : initial?.title ?? "Edit product"}
          </h1>
          <div className="flex items-center gap-2">
            {mode === "edit" && canDelete ? (
              <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={saving}>
                <Trash2 className="size-4" aria-hidden />
                Delete
              </Button>
            ) : null}
            <Button onClick={handleSave} disabled={saving || !canWrite}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {mode === "create" ? "Create product" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Title, URL slug and description.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="product-title">Title</Label>
                <Input
                  id="product-title"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  disabled={!canWrite}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-slug">Slug</Label>
                <Input
                  id="product-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value);
                  }}
                  disabled={!canWrite}
                />
                <p className="text-xs text-muted-foreground">
                  Used in the storefront URL. Auto-generated from the title until you edit it;
                  lowercase letters, numbers and hyphens only.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-description">Description</Label>
                <Textarea
                  id="product-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  disabled={!canWrite}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Variants</CardTitle>
              <CardDescription>
                Add options like Size or Color, then set a price per variant. Without options the
                single row is the default variant.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VariantEditor
                optionNames={optionNames}
                onOptionNamesChange={setOptionNames}
                variants={variants}
                onVariantsChange={setVariants}
                currency={currency}
                disabled={!canWrite}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Images</CardTitle>
              <CardDescription>The first image is the product thumbnail.</CardDescription>
              <CardAction>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPickerOpen(true)}
                  disabled={!canWrite}
                >
                  <ImagePlus className="size-4" aria-hidden />
                  Add images
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {images.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
                  <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">
                    No images yet. Pick from the media library or upload new ones.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {images.map((img, i) => (
                    <li key={`${img.url}-${i}`} className="flex items-center gap-3 rounded-lg border p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="size-14 rounded-md border object-cover" />
                      <Input
                        value={img.alt}
                        onChange={(e) =>
                          setImages((prev) =>
                            prev.map((item, idx) =>
                              idx === i ? { ...item, alt: e.target.value } : item,
                            ),
                          )
                        }
                        placeholder="Alt text"
                        className="flex-1"
                        disabled={!canWrite}
                        aria-label={`Alt text for image ${i + 1}`}
                      />
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => moveImage(i, -1)}
                          disabled={!canWrite || i === 0}
                          aria-label="Move image up"
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => moveImage(i, 1)}
                          disabled={!canWrite || i === images.length - 1}
                          aria-label="Move image down"
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          disabled={!canWrite}
                          aria-label="Remove image"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SEO</CardTitle>
              <CardDescription>Overrides for search engines and social sharing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="product-meta-title">Meta title</Label>
                <Input
                  id="product-meta-title"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-meta-description">Meta description</Label>
                <Textarea
                  id="product-meta-description"
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  rows={3}
                  disabled={!canWrite}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-og-image">Open Graph image URL</Label>
                <Input
                  id="product-og-image"
                  type="url"
                  value={ogImageUrl}
                  onChange={(e) => setOgImageUrl(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Only active products appear on the storefront.</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as ProductFormInitial["status"])}
                disabled={!canWrite}
              >
                <SelectTrigger className="w-full" aria-label="Product status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
              <CardDescription>
                Optional product-level price, used when variants don&apos;t set their own.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="product-base-price">Base price ({currency})</Label>
                <Input
                  id="product-base-price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-base-compare">Compare-at price ({currency})</Label>
                <Input
                  id="product-base-compare"
                  type="number"
                  min={0}
                  step={0.01}
                  value={baseCompareAtPrice}
                  onChange={(e) => setBaseCompareAtPrice(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {categories === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ) : orderedCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No categories yet.</p>
              ) : (
                orderedCategories.map(({ category, depth }) => (
                  <div
                    key={category.id}
                    className={`flex items-center gap-2 ${depth > 0 ? "pl-6" : ""}`}
                  >
                    <Checkbox
                      id={`category-${category.id}`}
                      checked={categoryIds.includes(category.id)}
                      onCheckedChange={(checked) =>
                        setCategoryIds((prev) => toggleId(prev, category.id, checked === true))
                      }
                      disabled={!canWrite}
                    />
                    <Label htmlFor={`category-${category.id}`} className="font-normal">
                      {category.name}
                    </Label>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Collections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {collections === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No collections yet.</p>
              ) : (
                collections.map((collection) => (
                  <div key={collection.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`collection-${collection.id}`}
                      checked={collectionIds.includes(collection.id)}
                      onCheckedChange={(checked) =>
                        setCollectionIds((prev) => toggleId(prev, collection.id, checked === true))
                      }
                      disabled={!canWrite}
                    />
                    <Label htmlFor={`collection-${collection.id}`} className="font-normal">
                      {collection.name}
                    </Label>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(selection) =>
          setImages((prev) => [
            ...prev,
            ...selection.map((item) => ({ url: item.url, alt: item.alt ?? "", variantId: null })),
          ])
        }
      />

      {mode === "edit" ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete this product?"
          description="The product will be removed from the catalog. Existing orders keep their purchase snapshots."
          confirmLabel="Delete"
          onConfirm={async () => {
            setDeleteOpen(false);
            await handleDelete();
          }}
        />
      ) : null}
    </div>
  );
}
