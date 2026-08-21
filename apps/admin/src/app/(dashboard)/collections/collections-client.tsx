"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client-api";
import { formatDate } from "@/lib/format";

type CollectionRule = {
  field: "category" | "title";
  operator: "equals" | "contains";
  value: string;
};

type Collection = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isManual: boolean;
  rules: CollectionRule[] | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  productCount: number;
};

type CollectionDetail = Collection & { productIds: string[] };

type ProductRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  minPrice: number | null;
  maxPrice: number | null;
  variantCount: number;
  totalStock: number | null;
  thumbnailUrl: string | null;
  updatedAt: string;
};

type ManagedProduct = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
};

const MAX_RULES = 10;

export function CollectionsClient({ canWrite }: { canWrite: boolean }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; collection: Collection } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<Collection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setCollections(await apiFetch<Collection[]>("/api/admin/collections"));
    } catch (err) {
      setFailed(true);
      toast.error("Failed to load collections", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await apiFetch<{ deleted: boolean }>(`/api/admin/collections/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toast.success("Collection deleted");
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collections"
        description="Curated or rule-based product groupings for merchandising."
        actions={
          canWrite ? (
            <Button onClick={() => setDialog({ mode: "create" })}>
              <Plus className="size-4" aria-hidden />
              New collection
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon={Layers}
          title="Couldn't load collections"
          description="Something went wrong while fetching collections."
          action={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No collections yet"
          description="Group products manually or with rules — perfect for seasonal sets and featured picks."
          action={
            canWrite ? (
              <Button onClick={() => setDialog({ mode: "create" })}>
                <Plus className="size-4" aria-hidden />
                New collection
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-28 text-right">Products</TableHead>
                <TableHead className="w-44">Updated</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((collection) => (
                <TableRow key={collection.id}>
                  <TableCell>
                    <p className="font-medium">{collection.name}</p>
                    <p className="text-xs text-muted-foreground">/{collection.slug}</p>
                  </TableCell>
                  <TableCell>
                    {collection.isManual ? (
                      <Badge variant="secondary">Manual</Badge>
                    ) : (
                      <Badge>Rule-based</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {collection.isManual ? (
                      collection.productCount
                    ) : (
                      <span className="text-muted-foreground">Auto</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(collection.updatedAt)}
                  </TableCell>
                  <TableCell>
                    {canWrite ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${collection.name}`}
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialog({ mode: "edit", collection })}>
                            <Pencil className="size-4" aria-hidden />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteTarget(collection)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog ? (
        <CollectionFormDialog
          key={dialog.mode === "edit" ? dialog.collection.id : "create"}
          editing={dialog.mode === "edit" ? dialog.collection : null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete collection?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be deleted. Products in it are not affected.`
            : ""
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function CollectionFormDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Collection | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing !== null);
  const [description, setDescription] = useState(editing?.description ?? "");
  const [isManual, setIsManual] = useState(editing?.isManual ?? true);
  const [rules, setRules] = useState<CollectionRule[]>(editing?.rules ?? []);
  const [saving, setSaving] = useState(false);

  // Manual product management (edit mode only).
  const [items, setItems] = useState<ManagedProduct[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsLoadFailed, setItemsLoadFailed] = useState(false);
  const [itemsLoadAttempt, setItemsLoadAttempt] = useState(0);
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    setItemsLoading(true);
    setItemsLoadFailed(false);
    void (async () => {
      try {
        const [detail, page] = await Promise.all([
          apiFetch<CollectionDetail>(`/api/admin/collections/${editing.id}`),
          apiFetch<Paginated<ProductRow>>(
            `/api/admin/products?collectionId=${editing.id}&pageSize=100`,
          ),
        ]);
        if (cancelled) return;
        const byId = new Map(page.items.map((p) => [p.id, p]));
        setItems(
          detail.productIds.map((id) => {
            const product = byId.get(id);
            return {
              id,
              title: product?.title ?? "Unknown product",
              thumbnailUrl: product?.thumbnailUrl ?? null,
            };
          }),
        );
      } catch (err) {
        if (!cancelled) {
          setItemsLoadFailed(true);
          toast.error("Failed to load collection products", {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, itemsLoadAttempt]);

  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await apiFetch<Paginated<ProductRow>>(
            `/api/admin/products?q=${encodeURIComponent(q)}&pageSize=10`,
          );
          setResults(page.items);
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQ]);

  function updateRule(index: number, patch: Partial<CollectionRule>) {
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  function moveItem(index: number, delta: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const validRules = rules
        .filter((rule) => rule.value.trim().length > 0)
        .map((rule) => ({ ...rule, value: rule.value.trim() }));
      const body = {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        description: description.trim() ? description.trim() : null,
        isManual,
        rules: isManual ? null : validRules,
      };
      if (editing) {
        await apiFetch(`/api/admin/collections/${editing.id}`, { method: "PATCH", body });
        // Only sync memberships once the product list actually loaded — a PUT
        // before (or after a failed) load would wipe the collection's products.
        if (isManual && !itemsLoading && !itemsLoadFailed) {
          await apiFetch<{ updated: boolean }>(`/api/admin/collections/${editing.id}/products`, {
            method: "PUT",
            body: { productIds: items.map((item) => item.id) },
          });
        }
        toast.success("Collection updated");
      } else {
        await apiFetch("/api/admin/collections", { method: "POST", body });
        toast.success("Collection created");
      }
      onSaved();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit collection" : "New collection"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the collection's details and products."
              : "Group products manually or automatically with rules."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="collection-name">Name</Label>
              <Input
                id="collection-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="collection-slug">Slug</Label>
              <Input
                id="collection-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="auto-generated from name"
                maxLength={200}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase letters, numbers and hyphens"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="collection-description">Description</Label>
            <Textarea
              id="collection-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="collection-manual">Manual collection</Label>
              <p className="text-sm text-muted-foreground">
                Pick products by hand. Turn off to match products automatically with rules.
              </p>
            </div>
            <Switch id="collection-manual" checked={isManual} onCheckedChange={setIsManual} />
          </div>

          {!isManual ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Rules</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rules.length >= MAX_RULES}
                  onClick={() =>
                    setRules((prev) => [...prev, { field: "title", operator: "contains", value: "" }])
                  }
                >
                  <Plus className="size-4" aria-hidden />
                  Add rule
                </Button>
              </div>
              {rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rules yet — add one to match products by category or title.
                </p>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Select
                        value={rule.field}
                        onValueChange={(v) => updateRule(index, { field: v as CollectionRule["field"] })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="category">Category</SelectItem>
                          <SelectItem value="title">Title</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={rule.operator}
                        onValueChange={(v) =>
                          updateRule(index, { operator: v as CollectionRule["operator"] })
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">Equals</SelectItem>
                          <SelectItem value="contains">Contains</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={rule.value}
                        onChange={(e) => updateRule(index, { value: e.target.value })}
                        placeholder={rule.field === "category" ? "category slug or id" : "Value"}
                        maxLength={200}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove rule"
                        onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {isManual && editing ? (
            <>
              <Separator />
              <div className="space-y-3">
                <div>
                  <Label>Manage products</Label>
                  <p className="text-sm text-muted-foreground">
                    Search for products to add. Order here is the storefront order.
                  </p>
                </div>
                <div className="relative">
                  <Search
                    className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search products…"
                    className="pl-8"
                  />
                </div>
                {searchQ.trim() ? (
                  <div className="rounded-md border">
                    {searching ? (
                      <p className="p-3 text-sm text-muted-foreground">Searching…</p>
                    ) : results.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">No products found.</p>
                    ) : (
                      results.map((product) => {
                        const added = items.some((item) => item.id === product.id);
                        return (
                          <div
                            key={product.id}
                            className="flex items-center gap-3 border-b p-2 last:border-b-0"
                          >
                            <ProductThumb title={product.title} url={product.thumbnailUrl} />
                            <p className="flex-1 truncate text-sm">{product.title}</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={added}
                              onClick={() =>
                                setItems((prev) => [
                                  ...prev,
                                  {
                                    id: product.id,
                                    title: product.title,
                                    thumbnailUrl: product.thumbnailUrl,
                                  },
                                ])
                              }
                            >
                              {added ? "Added" : "Add"}
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}

                {itemsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : itemsLoadFailed ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <p className="text-sm text-muted-foreground">
                      Product list failed to load — memberships left unchanged.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setItemsLoadAttempt((n) => n + 1)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No products in this collection yet.</p>
                ) : (
                  <div className="rounded-md border">
                    {items.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 border-b p-2 last:border-b-0"
                      >
                        <span className="w-6 text-center text-xs text-muted-foreground tabular-nums">
                          {index + 1}
                        </span>
                        <ProductThumb title={item.title} url={item.thumbnailUrl} />
                        <p className="flex-1 truncate text-sm">{item.title}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Move up"
                          disabled={index === 0}
                          onClick={() => moveItem(index, -1)}
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Move down"
                          disabled={index === items.length - 1}
                          onClick={() => moveItem(index, 1)}
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove"
                          onClick={() =>
                            setItems((prev) => prev.filter((p) => p.id !== item.id))
                          }
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || (isManual && itemsLoading)}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {editing ? "Save changes" : "Create collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductThumb({ title, url }: { title: string; url: string | null }) {
  if (!url) {
    return <div className="size-8 shrink-0 rounded-md bg-muted" aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={title} className="size-8 shrink-0 rounded-md object-cover" />;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
