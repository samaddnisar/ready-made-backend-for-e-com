"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FolderTree,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
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
import { Skeleton } from "@/components/ui/skeleton";
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

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  position: number;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  productCount: number;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Flatten the parentId tree into display order with depth (server order preserved within siblings). */
function flattenTree(categories: Category[]): { category: Category; depth: number }[] {
  const ids = new Set(categories.map((c) => c.id));
  const byParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    // Treat rows whose parent is missing (e.g. filtered out) as roots.
    const key = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(category);
    byParent.set(key, siblings);
  }
  const rows: { category: Category; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      rows.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** The category itself plus everything under it — invalid parent choices when editing. */
function selfAndDescendantIds(categories: Category[], rootId: string): Set<string> {
  const excluded = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId && excluded.has(category.parentId) && !excluded.has(category.id)) {
        excluded.add(category.id);
        changed = true;
      }
    }
  }
  return excluded;
}

export function CategoriesClient({ canWrite }: { canWrite: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; category: Category } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setCategories(await apiFetch<Category[]>("/api/admin/categories"));
    } catch (err) {
      setFailed(true);
      toast.error("Failed to load categories", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flattenTree(categories), [categories]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await apiFetch<{ deleted: boolean }>(`/api/admin/categories/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toast.success("Category deleted");
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
        title="Categories"
        description="Hierarchical product taxonomy shown in storefront navigation."
        actions={
          canWrite ? (
            <Button onClick={() => setDialog({ mode: "create" })}>
              <Plus className="size-4" aria-hidden />
              New category
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
          icon={FolderTree}
          title="Couldn't load categories"
          description="Something went wrong while fetching categories."
          action={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No categories yet"
          description="Organize products into a browsable tree — categories can nest under a parent."
          action={
            canWrite ? (
              <Button onClick={() => setDialog({ mode: "create" })}>
                <Plus className="size-4" aria-hidden />
                New category
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
                <TableHead className="w-32 text-right">Products</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ category, depth }) => (
                <TableRow key={category.id}>
                  <TableCell>
                    <div
                      className="flex items-center gap-2"
                      style={{ paddingLeft: `${depth * 1.5}rem` }}
                    >
                      {depth > 0 ? (
                        <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      ) : null}
                      <div>
                        <p className="font-medium">{category.name}</p>
                        <p className="text-xs text-muted-foreground">/{category.slug}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{category.productCount}</TableCell>
                  <TableCell>
                    {canWrite ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${category.name}`}>
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialog({ mode: "edit", category })}>
                            <Pencil className="size-4" aria-hidden />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteTarget(category)}
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
        <CategoryFormDialog
          key={dialog.mode === "edit" ? dialog.category.id : "create"}
          categories={categories}
          editing={dialog.mode === "edit" ? dialog.category : null}
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
        title="Delete category?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be deleted. Its subcategories move to the root level; products keep their other categories.`
            : ""
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function CategoryFormDialog({
  categories,
  editing,
  onClose,
  onSaved,
}: {
  categories: Category[];
  editing: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing !== null);
  const [parentId, setParentId] = useState<string>(editing?.parentId ?? "none");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [seoOpen, setSeoOpen] = useState(
    Boolean(editing && (editing.metaTitle || editing.metaDescription || editing.ogImageUrl)),
  );
  const [metaTitle, setMetaTitle] = useState(editing?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(editing?.metaDescription ?? "");
  const [ogImageUrl, setOgImageUrl] = useState(editing?.ogImageUrl ?? "");
  const [saving, setSaving] = useState(false);

  const parentOptions = useMemo(() => {
    if (!editing) return categories;
    const excluded = selfAndDescendantIds(categories, editing.id);
    return categories.filter((c) => !excluded.has(c.id));
  }, [categories, editing]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        description: description.trim() ? description.trim() : null,
        parentId: parentId === "none" ? null : parentId,
        metaTitle: metaTitle.trim() ? metaTitle.trim() : null,
        metaDescription: metaDescription.trim() ? metaDescription.trim() : null,
        ogImageUrl: ogImageUrl.trim() ? ogImageUrl.trim() : null,
      };
      if (editing) {
        await apiFetch(`/api/admin/categories/${editing.id}`, { method: "PATCH", body });
      } else {
        await apiFetch("/api/admin/categories", { method: "POST", body });
      }
      toast.success(editing ? "Category updated" : "Category created");
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the category's details."
              : "Add a category to the product taxonomy."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
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
            <Label htmlFor="category-slug">Slug</Label>
            <Input
              id="category-slug"
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
          <div className="space-y-1.5">
            <Label>Parent category</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (top level)</SelectItem>
                {parentOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-description">Description</Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
            />
          </div>

          <div className="space-y-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => setSeoOpen((v) => !v)}
            >
              {seoOpen ? (
                <ChevronDown className="size-4" aria-hidden />
              ) : (
                <ChevronRight className="size-4" aria-hidden />
              )}
              SEO settings
            </Button>
            {seoOpen ? (
              <div className="space-y-4 rounded-md border p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="category-meta-title">Meta title</Label>
                  <Input
                    id="category-meta-title"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category-meta-description">Meta description</Label>
                  <Textarea
                    id="category-meta-description"
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                    rows={2}
                    maxLength={500}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category-og-image">OG image URL</Label>
                  <Input
                    id="category-og-image"
                    type="url"
                    value={ogImageUrl}
                    onChange={(e) => setOgImageUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {editing ? "Save changes" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
