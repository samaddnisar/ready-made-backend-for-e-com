"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client-api";
import {
  describeApiError,
  type DiscountAppliesTo,
  type DiscountDetail,
  type DiscountType,
} from "./discount-shared";

type ProductHit = { id: string; title: string };
type CategoryOption = { id: string; name: string; parentId: string | null };
type SelectedProduct = { id: string; title: string };

/** ISO string → value for a datetime-local input (local time, minute precision). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Integer cents from a dollars input string; null when blank, NaN when invalid. */
function parseDollars(raw: string): number | null {
  if (raw.trim() === "") return null;
  const dollars = Number.parseFloat(raw);
  if (Number.isNaN(dollars) || dollars < 0) return Number.NaN;
  return Math.round(dollars * 100);
}

export function DiscountDialog({
  discountId,
  currency,
  onClose,
  onSaved,
}: {
  /** null = create, otherwise the discount being edited. */
  discountId: string | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = discountId !== null;
  const [loadingDetail, setLoadingDetail] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState("");
  const [type, setType] = useState<DiscountType>("percent");
  const [valueInput, setValueInput] = useState("");
  const [minSpendInput, setMinSpendInput] = useState("");
  const [usageLimitInput, setUsageLimitInput] = useState("");
  const [perCustomerInput, setPerCustomerInput] = useState("");
  const [startsAtInput, setStartsAtInput] = useState("");
  const [endsAtInput, setEndsAtInput] = useState("");
  const [stackable, setStackable] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [appliesTo, setAppliesTo] = useState<DiscountAppliesTo>("all");

  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  const [productQ, setProductQ] = useState("");
  const [productHits, setProductHits] = useState<ProductHit[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);

  // Edit mode: hydrate the form from the detail endpoint (includes target ids).
  useEffect(() => {
    if (!discountId) return;
    let cancelled = false;
    setLoadingDetail(true);
    apiFetch<DiscountDetail>(`/api/admin/discounts/${discountId}`)
      .then(async (d) => {
        if (cancelled) return;
        setCode(d.code);
        setType(d.type);
        setValueInput(
          d.type === "percent"
            ? String(d.value)
            : d.type === "fixed"
              ? (d.value / 100).toFixed(2)
              : "",
        );
        setMinSpendInput(d.minSpend === null ? "" : (d.minSpend / 100).toFixed(2));
        setUsageLimitInput(d.usageLimit === null ? "" : String(d.usageLimit));
        setPerCustomerInput(d.perCustomerLimit === null ? "" : String(d.perCustomerLimit));
        setStartsAtInput(toLocalInput(d.startsAt));
        setEndsAtInput(toLocalInput(d.endsAt));
        setStackable(d.stackable);
        setIsActive(d.isActive);
        setAppliesTo(d.appliesTo);
        setSelectedCategoryIds(d.categoryIds);
        setLoadingDetail(false);

        // The detail payload only carries product ids — resolve titles for chips.
        if (d.productIds.length > 0) {
          setSelectedProducts(
            d.productIds.map((id) => ({ id, title: `Product ${id.slice(0, 8)}…` })),
          );
          const results = await Promise.allSettled(
            d.productIds.map((id) => apiFetch<{ title: string }>(`/api/admin/products/${id}`)),
          );
          if (cancelled) return;
          setSelectedProducts(
            d.productIds.map((id, i) => {
              const r = results[i];
              return {
                id,
                title:
                  r && r.status === "fulfilled" ? r.value.title : `Product ${id.slice(0, 8)}…`,
              };
            }),
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error("Failed to load discount", { description: describeApiError(err) });
        onClose();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountId]);

  // Product picker: debounced search, only while the products scope is shown.
  useEffect(() => {
    if (appliesTo !== "products") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: "1", pageSize: "10" });
      if (productQ) params.set("q", productQ);
      apiFetch<Paginated<ProductHit>>(`/api/admin/products?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((r) => setProductHits(r.items))
        .catch(() => {
          if (!controller.signal.aborted) setProductHits([]);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [appliesTo, productQ]);

  // Category list: fetched once, when the categories scope is first shown.
  useEffect(() => {
    if (appliesTo !== "categories" || categories !== null) return;
    let cancelled = false;
    apiFetch<CategoryOption[]>(`/api/admin/categories`)
      .then((r) => {
        if (!cancelled) setCategories(r);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCategories([]);
        toast.error("Failed to load categories", { description: describeApiError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [appliesTo, categories]);

  function addProduct(hit: ProductHit) {
    setSelectedProducts((prev) =>
      prev.some((p) => p.id === hit.id) ? prev : [...prev, { id: hit.id, title: hit.title }],
    );
  }

  function removeProduct(id: string) {
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function toggleCategory(id: string, checked: boolean) {
    setSelectedCategoryIds((prev) =>
      checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((c) => c !== id),
    );
  }

  /** Build the strict schema payload, or null (with a toast) when invalid. */
  function buildPayload(): Record<string, unknown> | null {
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length < 2) {
      toast.error("Code must be at least 2 characters");
      return null;
    }

    let value = 0;
    if (type === "percent") {
      value = Number.parseInt(valueInput, 10);
      if (Number.isNaN(value) || value < 1 || value > 100) {
        toast.error("Percent must be a whole number between 1 and 100");
        return null;
      }
    } else if (type === "fixed") {
      const cents = parseDollars(valueInput);
      if (cents === null || Number.isNaN(cents) || cents <= 0) {
        toast.error("Amount off must be a positive amount");
        return null;
      }
      value = cents;
    }

    const minSpend = parseDollars(minSpendInput);
    if (minSpend !== null && Number.isNaN(minSpend)) {
      toast.error("Minimum spend must be a non-negative amount");
      return null;
    }

    let usageLimit: number | null = null;
    if (usageLimitInput.trim() !== "") {
      usageLimit = Number.parseInt(usageLimitInput, 10);
      if (Number.isNaN(usageLimit) || usageLimit < 1) {
        toast.error("Usage limit must be at least 1");
        return null;
      }
    }

    let perCustomerLimit: number | null = null;
    if (perCustomerInput.trim() !== "") {
      perCustomerLimit = Number.parseInt(perCustomerInput, 10);
      if (Number.isNaN(perCustomerLimit) || perCustomerLimit < 1) {
        toast.error("Per-customer limit must be at least 1");
        return null;
      }
    }

    const startsAt = startsAtInput ? new Date(startsAtInput).toISOString() : null;
    const endsAt = endsAtInput ? new Date(endsAtInput).toISOString() : null;
    if (startsAt && endsAt && startsAt >= endsAt) {
      toast.error("End must be after start");
      return null;
    }

    const payload: Record<string, unknown> = {
      code: trimmedCode,
      type,
      value,
      minSpend,
      usageLimit,
      perCustomerLimit,
      startsAt,
      endsAt,
      appliesTo,
      stackable,
      isActive,
    };
    if (appliesTo === "products") {
      if (selectedProducts.length === 0) {
        toast.error("Select at least one product");
        return null;
      }
      payload.productIds = selectedProducts.map((p) => p.id);
    }
    if (appliesTo === "categories") {
      if (selectedCategoryIds.length === 0) {
        toast.error("Select at least one category");
        return null;
      }
      payload.categoryIds = selectedCategoryIds;
    }
    return payload;
  }

  async function save() {
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    try {
      if (discountId) {
        await apiFetch<DiscountDetail>(`/api/admin/discounts/${discountId}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Discount updated");
      } else {
        await apiFetch<DiscountDetail>(`/api/admin/discounts`, { method: "POST", body: payload });
        toast.success("Discount created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(discountId ? "Update failed" : "Create failed", {
        description: describeApiError(err),
      });
    } finally {
      setSaving(false);
    }
  }

  const availableHits = productHits?.filter(
    (hit) => !selectedProducts.some((p) => p.id === hit.id),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit discount" : "New discount"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the code, value, limits or scope."
              : "Create a discount code customers can apply at checkout."}
          </DialogDescription>
        </DialogHeader>

        {loadingDetail ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="disc-code">Code</Label>
                <Input
                  id="disc-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. SUMMER10"
                  className="font-mono uppercase"
                  maxLength={50}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disc-type">Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as DiscountType)}>
                  <SelectTrigger id="disc-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent off</SelectItem>
                    <SelectItem value="fixed">Fixed amount off</SelectItem>
                    <SelectItem value="free_shipping">Free shipping</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {type !== "free_shipping" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="disc-value">
                    {type === "percent" ? "Percent off" : `Amount off (${currency})`}
                  </Label>
                  <Input
                    id="disc-value"
                    type="number"
                    min={type === "percent" ? 1 : 0.01}
                    max={type === "percent" ? 100 : undefined}
                    step={type === "percent" ? 1 : 0.01}
                    value={valueInput}
                    onChange={(e) => setValueInput(e.target.value)}
                    placeholder={type === "percent" ? "e.g. 10" : "e.g. 5.00"}
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="disc-min-spend">Minimum spend ({currency})</Label>
                <Input
                  id="disc-min-spend"
                  type="number"
                  min={0}
                  step={0.01}
                  value={minSpendInput}
                  onChange={(e) => setMinSpendInput(e.target.value)}
                  placeholder="No minimum"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="disc-usage-limit">Usage limit</Label>
                <Input
                  id="disc-usage-limit"
                  type="number"
                  min={1}
                  step={1}
                  value={usageLimitInput}
                  onChange={(e) => setUsageLimitInput(e.target.value)}
                  placeholder="Unlimited"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disc-per-customer">Per-customer limit</Label>
                <Input
                  id="disc-per-customer"
                  type="number"
                  min={1}
                  step={1}
                  value={perCustomerInput}
                  onChange={(e) => setPerCustomerInput(e.target.value)}
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="disc-starts-at">Starts</Label>
                <Input
                  id="disc-starts-at"
                  type="datetime-local"
                  value={startsAtInput}
                  onChange={(e) => setStartsAtInput(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disc-ends-at">Ends</Label>
                <Input
                  id="disc-ends-at"
                  type="datetime-local"
                  value={endsAtInput}
                  onChange={(e) => setEndsAtInput(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="disc-applies-to">Applies to</Label>
              <Select
                value={appliesTo}
                onValueChange={(v) => setAppliesTo(v as DiscountAppliesTo)}
              >
                <SelectTrigger id="disc-applies-to" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  <SelectItem value="products">Specific products</SelectItem>
                  <SelectItem value="categories">Specific categories</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {appliesTo === "products" ? (
              <div className="space-y-2">
                {selectedProducts.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProducts.map((p) => (
                      <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
                        <span className="max-w-48 truncate">{p.title}</span>
                        <button
                          type="button"
                          onClick={() => removeProduct(p.id)}
                          aria-label={`Remove ${p.title}`}
                          className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No products selected yet.</p>
                )}
                <Input
                  value={productQ}
                  onChange={(e) => setProductQ(e.target.value)}
                  placeholder="Search products…"
                />
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {availableHits === undefined ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
                  ) : availableHits.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {productQ ? "No products match this search." : "No products to add."}
                    </p>
                  ) : (
                    availableHits.map((hit) => (
                      <button
                        type="button"
                        key={hit.id}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => addProduct(hit)}
                      >
                        <span className="truncate">{hit.title}</span>
                        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {appliesTo === "categories" ? (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {categories === null ? (
                  <div className="space-y-2 p-1">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                ) : categories.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    No categories yet — create some under Categories first.
                  </p>
                ) : (
                  categories.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={selectedCategoryIds.includes(c.id)}
                        onCheckedChange={(v) => toggleCategory(c.id, v === true)}
                      />
                      <span>{c.name}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="disc-stackable">Stackable</Label>
                <p className="text-sm text-muted-foreground">
                  Can be combined with other stackable codes.
                </p>
              </div>
              <Switch id="disc-stackable" checked={stackable} onCheckedChange={setStackable} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="disc-active">Active</Label>
                <p className="text-sm text-muted-foreground">
                  Inactive codes are rejected at checkout.
                </p>
              </div>
              <Switch id="disc-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || loadingDetail}>
            {isEdit ? "Save changes" : "Create discount"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
