"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  File,
  Image as ImageIcon,
  Loader2,
  Search,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { apiFetch, apiUpload } from "@/lib/client-api";
import { formatDate } from "@/lib/format";

type MediaItem = {
  id: string;
  url: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  alt: string | null;
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type TypeFilter = "all" | "image" | "video" | "other";

const PAGE_SIZE = 24;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (item: MediaItem) => item.mimeType.startsWith("image/");
const isVideo = (item: MediaItem) => item.mimeType.startsWith("video/");

export function MediaClient({ canWrite }: { canWrite: boolean }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<MediaItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (debouncedQ) params.set("q", debouncedQ);
      if (type !== "all") params.set("type", type);
      setData(await apiFetch<Paginated<MediaItem>>(`/api/admin/media?${params.toString()}`));
    } catch (err) {
      setFailed(true);
      toast.error("Failed to load media", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [page, debouncedQ, type]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploading(true);
    let succeeded = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      const toastId = toast.loading(`Uploading ${file.name} (${i + 1} of ${list.length})…`);
      try {
        const formData = new FormData();
        formData.append("file", file);
        await apiUpload<MediaItem>("/api/admin/media", formData);
        toast.success(`Uploaded ${file.name}`, { id: toastId });
        succeeded++;
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`, {
          id: toastId,
          description: err instanceof Error ? err.message : undefined,
        });
      }
    }
    setUploading(false);
    if (succeeded > 0) {
      if (page !== 1) setPage(1);
      else void load();
    }
  }

  const hasFilters = debouncedQ.length > 0 || type !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media library"
        description="Uploaded assets, browsable and reusable across products and content."
        actions={
          canWrite ? (
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-4" aria-hidden />
              )}
              Upload
            </Button>
          ) : undefined
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by filename…"
            className="pl-8"
          />
        </div>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v as TypeFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="image">Images</SelectItem>
            <SelectItem value="video">Videos</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon={ImageIcon}
          title="Couldn't load media"
          description="Something went wrong while fetching the media library."
          action={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={hasFilters ? "No media match your filters" : "No media yet"}
          description={
            hasFilters
              ? "Try a different search or type filter."
              : "Upload images and videos to reuse across products and content."
          }
          action={
            canWrite && !hasFilters ? (
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="size-4" aria-hidden />
                Upload
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className="group overflow-hidden rounded-md border text-left transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
                  {isImage(item) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.url}
                      alt={item.alt ?? item.filename}
                      className="size-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : isVideo(item) ? (
                    <Video className="size-8 text-muted-foreground" aria-hidden />
                  ) : (
                    <File className="size-8 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="space-y-0.5 p-2">
                  <p className="truncate text-sm font-medium">{item.filename}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(item.sizeBytes)}</p>
                </div>
              </button>
            ))}
          </div>
          <TablePagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        </>
      )}

      {selected ? (
        <MediaDetailDialog
          key={selected.id}
          item={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function MediaDetailDialog({
  item,
  canWrite,
  onClose,
  onChanged,
}: {
  item: MediaItem;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [alt, setAlt] = useState(item.alt ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function saveAlt() {
    setSaving(true);
    try {
      await apiFetch<MediaItem>(`/api/admin/media/${item.id}`, {
        method: "PATCH",
        body: { alt: alt.trim() ? alt.trim() : null },
      });
      toast.success("Alt text saved");
      onChanged();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    try {
      await apiFetch<{ deleted: boolean }>(`/api/admin/media/${item.id}`, { method: "DELETE" });
      toast.success("Media deleted");
      setConfirmOpen(false);
      onChanged();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(item.url);
      toast.success("URL copied");
    } catch {
      toast.error("Couldn't copy URL");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{item.filename}</DialogTitle>
          <DialogDescription>
            {item.mimeType} · {formatBytes(item.sizeBytes)} · uploaded {formatDate(item.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-72 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {isImage(item) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.url}
              alt={item.alt ?? item.filename}
              className="max-h-72 w-full object-contain"
            />
          ) : isVideo(item) ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <Video className="size-10 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Video file</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-12">
              <File className="size-10 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">{item.filename}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="media-url">URL</Label>
            <div className="flex items-center gap-2">
              <Input id="media-url" value={item.url} readOnly className="flex-1" />
              <Button type="button" variant="outline" size="icon" aria-label="Copy URL" onClick={() => void copyUrl()}>
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="media-alt">Alt text</Label>
            <div className="flex items-center gap-2">
              <Input
                id="media-alt"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="Describe this asset for accessibility"
                maxLength={300}
                disabled={!canWrite}
                className="flex-1"
              />
              <Button type="button" onClick={() => void saveAlt()} disabled={saving || !canWrite}>
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Save
              </Button>
            </div>
          </div>
          {canWrite ? (
            <Button type="button" variant="destructive" onClick={() => setConfirmOpen(true)}>
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          ) : null}
        </div>

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete media?"
          description={`"${item.filename}" will be permanently removed from storage. Products referencing this URL will show a broken image.`}
          onConfirm={confirmDelete}
        />
      </DialogContent>
    </Dialog>
  );
}
