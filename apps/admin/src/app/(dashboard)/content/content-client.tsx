"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Newspaper,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate } from "@/lib/format";

type ContentStatus = "draft" | "published";

/** Wire shape (JSON): dates arrive as ISO strings. Post-only fields optional. */
type ContentRow = {
  id: string;
  title: string;
  slug: string;
  content: string | null;
  status: ContentStatus;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  tags?: string[];
  publishedAt?: string | null;
};

type Kind = "posts" | "pages";

const KIND_CONFIG: Record<
  Kind,
  { endpoint: string; singular: string; icon: typeof FileText; emptyHint: string }
> = {
  posts: {
    endpoint: "/api/admin/content/posts",
    singular: "post",
    icon: Newspaper,
    emptyHint: "Write your first post — drafts stay hidden until you publish.",
  },
  pages: {
    endpoint: "/api/admin/content/pages",
    singular: "page",
    icon: FileText,
    emptyHint: "Create standalone pages like About, FAQ or Shipping policy.",
  },
};

const PAGE_SIZE = 20;

/** Client-side mirror of core's slugify — for live slug preview only. */
function clientSlugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function StatusBadge({ status }: { status: ContentStatus }) {
  if (status === "published") {
    return (
      <Badge variant="secondary">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Published
      </Badge>
    );
  }
  return <Badge variant="outline">Draft</Badge>;
}

export function ContentClient({
  canCreate,
  canWrite,
  canDelete,
}: {
  canCreate: boolean;
  canWrite: boolean;
  canDelete: boolean;
}) {
  return (
    <Tabs defaultValue="posts">
      <TabsList>
        <TabsTrigger value="posts">Blog posts</TabsTrigger>
        <TabsTrigger value="pages">Pages</TabsTrigger>
      </TabsList>
      <TabsContent value="posts">
        <ContentTable kind="posts" canCreate={canCreate} canWrite={canWrite} canDelete={canDelete} />
      </TabsContent>
      <TabsContent value="pages">
        <ContentTable kind="pages" canCreate={canCreate} canWrite={canWrite} canDelete={canDelete} />
      </TabsContent>
    </Tabs>
  );
}

// ── Per-tab table ────────────────────────────────────────────

function ContentTable({
  kind,
  canCreate,
  canWrite,
  canDelete,
}: {
  kind: Kind;
  canCreate: boolean;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const config = KIND_CONFIG[kind];
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<"all" | ContentStatus>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ContentRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editor, setEditor] = useState<{ item: ContentRow | null } | null>(null);
  const [deleting, setDeleting] = useState<ContentRow | null>(null);

  // Debounce the search input (300ms) and reset to page 1 on change.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQ) params.set("q", debouncedQ);
    if (status !== "all") params.set("status", status);

    setLoading(true);
    apiFetch<Paginated<ContentRow>>(`${config.endpoint}?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setLoadFailed(false);
        setLoading(false);
        // A shrinking result set can strand the current page — clamp back.
        if (result.totalPages < page) setPage(Math.max(1, result.totalPages));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setLoading(false);
        toast.error(`Failed to load ${kind}`, {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [config.endpoint, kind, debouncedQ, status, page, refreshKey]);

  const reload = () => setRefreshKey((k) => k + 1);

  async function remove(item: ContentRow) {
    try {
      await apiFetch(`${config.endpoint}/${item.id}`, { method: "DELETE" });
      toast.success(`${kind === "posts" ? "Post" : "Page"} deleted`);
      reload();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setDeleting(null);
    }
  }

  const items = data?.items ?? [];
  const hasFilters = debouncedQ !== "" || status !== "all";
  const showSkeleton = loading && !data;
  const showError = loadFailed && !loading;
  const showEmpty = !showError && !showSkeleton && items.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or slug…"
            className="pl-8"
            aria-label={`Search ${kind}`}
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as "all" | ContentStatus);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
        {canCreate ? (
          <Button onClick={() => setEditor({ item: null })}>
            <Plus className="size-4" aria-hidden />
            New {config.singular}
          </Button>
        ) : null}
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title={`Couldn't load ${kind}`}
          description="Something went wrong. Check your connection and try again."
          action={
            <Button variant="outline" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={config.icon}
          title={hasFilters ? `No ${kind} match` : `No ${kind} yet`}
          description={hasFilters ? "Try a different search or status filter." : config.emptyHint}
          action={
            !hasFilters && canCreate ? (
              <Button onClick={() => setEditor({ item: null })}>
                <Plus className="size-4" aria-hidden />
                New {config.singular}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    {canWrite || canDelete ? <TableHead className="w-20" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-48" />
                              <Skeleton className="h-3 w-32" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-20 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-32" />
                          </TableCell>
                          {canWrite || canDelete ? (
                            <TableCell>
                              <Skeleton className="h-8 w-16" />
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))
                    : items.map((item) => (
                        <TableRow
                          key={item.id}
                          className={canWrite ? "cursor-pointer" : undefined}
                          onClick={canWrite ? () => setEditor({ item }) : undefined}
                        >
                          <TableCell>
                            <p className="font-medium">{item.title}</p>
                            <p className="text-sm text-muted-foreground">/{item.slug}</p>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={item.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(item.updatedAt)}
                          </TableCell>
                          {canWrite || canDelete ? (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                {canWrite ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Edit ${item.title}`}
                                    onClick={() => setEditor({ item })}
                                  >
                                    <Pencil className="size-4" aria-hidden />
                                  </Button>
                                ) : null}
                                {canDelete ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete ${item.title}`}
                                    onClick={() => setDeleting(item)}
                                  >
                                    <Trash2 className="size-4" aria-hidden />
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!showError && data && data.total > 0 ? (
        <TablePagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          onPageChange={setPage}
        />
      ) : null}

      {editor ? (
        <EditorSheet
          kind={kind}
          item={editor.item}
          onClose={() => setEditor(null)}
          onSaved={reload}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ""}"?`}
        description={
          deleting?.status === "published"
            ? `This ${config.singular} is live — deleting it removes it from the storefront immediately.`
            : `This draft ${config.singular} will be removed.`
        }
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />
    </div>
  );
}

// ── Editor (slide-over) ──────────────────────────────────────

function EditorSheet({
  kind,
  item,
  onClose,
  onSaved,
}: {
  kind: Kind;
  item: ContentRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const config = KIND_CONFIG[kind];
  const isPost = kind === "posts";

  const [title, setTitle] = useState(item?.title ?? "");
  const [slug, setSlug] = useState(item?.slug ?? "");
  // Auto-generate the slug from the title until the user edits it directly.
  const [slugTouched, setSlugTouched] = useState(item !== null);
  const [content, setContent] = useState(item?.content ?? "");
  const [excerpt, setExcerpt] = useState(item?.excerpt ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(item?.coverImageUrl ?? "");
  const [tagsInput, setTagsInput] = useState((item?.tags ?? []).join(", "));
  const [showSeo, setShowSeo] = useState(false);
  const [metaTitle, setMetaTitle] = useState(item?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(item?.metaDescription ?? "");
  const [ogImageUrl, setOgImageUrl] = useState(item?.ogImageUrl ?? "");
  const [saving, setSaving] = useState(false);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(clientSlugify(value));
  }

  function nullableUrl(value: string, label: string): string | null | undefined {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (!/^https?:\/\//.test(trimmed)) {
      toast.error(`${label} must be an http(s) URL`);
      return undefined;
    }
    return trimmed;
  }

  async function save(status: ContentStatus) {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (content.length > 100_000) {
      toast.error("Content is too long (max 100,000 characters)");
      return;
    }
    if (excerpt.length > 500) {
      toast.error("Excerpt is too long (max 500 characters)");
      return;
    }
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 10) {
      toast.error("At most 10 tags");
      return;
    }
    const cover = nullableUrl(coverImageUrl, "Cover image URL");
    if (cover === undefined) return;
    const ogImage = nullableUrl(ogImageUrl, "OG image URL");
    if (ogImage === undefined) return;

    const body: Record<string, unknown> = {
      title: title.trim(),
      content: content === "" ? null : content,
      status,
      metaTitle: metaTitle.trim() === "" ? null : metaTitle.trim(),
      metaDescription: metaDescription.trim() === "" ? null : metaDescription.trim(),
      ogImageUrl: ogImage,
    };
    // Blank slug → let the server generate one from the title.
    const normalizedSlug = clientSlugify(slug);
    if (normalizedSlug) body.slug = normalizedSlug;
    if (isPost) {
      body.excerpt = excerpt.trim() === "" ? null : excerpt.trim();
      body.coverImageUrl = cover;
      body.tags = tags;
    }

    setSaving(true);
    try {
      if (item) {
        await apiFetch(`${config.endpoint}/${item.id}`, { method: "PATCH", body });
      } else {
        await apiFetch(config.endpoint, { method: "POST", body });
      }
      toast.success(
        status === "published"
          ? `${isPost ? "Post" : "Page"} published`
          : `${isPost ? "Post" : "Page"} saved as draft`,
      );
      onSaved();
      onClose();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>
            {item ? `Edit ${config.singular}` : `New ${config.singular}`}
          </SheetTitle>
          <SheetDescription>
            {isPost
              ? "Markdown or plain text. The excerpt is what blog index cards show."
              : "Markdown or plain text, served at /pages/<slug>."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <Label htmlFor="content-title">Title</Label>
            <Input
              id="content-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder={isPost ? "e.g. Our summer lookbook" : "e.g. About us"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content-slug">Slug</Label>
            <Input
              id="content-slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="auto-generated-from-title"
            />
            <p className="text-sm text-muted-foreground">
              Lowercase letters, numbers and hyphens. Leave blank to generate from the title.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content-body">Content</Label>
            <Textarea
              id="content-body"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write in Markdown or plain text…"
              className="min-h-72 font-mono text-sm"
            />
          </div>

          {isPost ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="post-excerpt">Excerpt</Label>
                <Textarea
                  id="post-excerpt"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Short teaser shown on the blog index (max 500 characters)"
                  className="min-h-20"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="post-cover">Cover image URL</Label>
                <Input
                  id="post-cover"
                  value={coverImageUrl}
                  onChange={(e) => setCoverImageUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="post-tags">Tags</Label>
                <Input
                  id="post-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="news, lookbook, sale"
                />
                <p className="text-sm text-muted-foreground">
                  Comma-separated, up to 10.
                </p>
              </div>
            </>
          ) : null}

          <div className="rounded-md border">
            <button
              type="button"
              className="flex w-full items-center gap-2 p-3 text-sm font-medium"
              onClick={() => setShowSeo((v) => !v)}
              aria-expanded={showSeo}
            >
              {showSeo ? (
                <ChevronDown className="size-4" aria-hidden />
              ) : (
                <ChevronRight className="size-4" aria-hidden />
              )}
              SEO
            </button>
            {showSeo ? (
              <div className="space-y-4 border-t p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="seo-title">Meta title</Label>
                  <Input
                    id="seo-title"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    placeholder="Defaults to the title"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seo-description">Meta description</Label>
                  <Textarea
                    id="seo-description"
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                    className="min-h-20"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seo-og">OG image URL</Label>
                  <Input
                    id="seo-og"
                    value={ogImageUrl}
                    onChange={(e) => setOgImageUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => void save("draft")} disabled={saving}>
            Save as draft
          </Button>
          <Button onClick={() => void save("published")} disabled={saving}>
            Publish
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
