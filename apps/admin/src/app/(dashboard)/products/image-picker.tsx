"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImageIcon, Loader2, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import { TablePagination } from "@/components/table-pagination";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, apiUpload } from "@/lib/client-api";

export type MediaSelection = { url: string; alt: string | null };

/** Subset of the media row the picker needs (extra JSON fields are ignored). */
type MediaRow = { id: string; url: string; alt: string | null; filename: string };

const PAGE_SIZE = 24;

export function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (items: MediaSelection[]) => void;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<MediaRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Map<string, MediaRow>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fresh selection every time the picker opens.
  useEffect(() => {
    if (open) setSelected(new Map());
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      type: "image",
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (debouncedQ) params.set("q", debouncedQ);

    setLoading(true);
    apiFetch<Paginated<MediaRow>>(`/api/admin/media?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        toast.error("Failed to load media", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [open, debouncedQ, page, refreshKey]);

  function toggle(item: MediaRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: MediaRow[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        uploaded.push(await apiUpload<MediaRow>("/api/admin/media", form));
      }
      toast.success(
        uploaded.length === 1 ? "Image uploaded" : `${uploaded.length} images uploaded`,
      );
      // Newly uploaded files are pre-selected and the list refreshed.
      setSelected((prev) => {
        const next = new Map(prev);
        for (const item of uploaded) next.set(item.id, item);
        return next;
      });
      setPage(1);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function confirmSelection() {
    onSelect(Array.from(selected.values()).map((item) => ({ url: item.url, alt: item.alt })));
    onOpenChange(false);
  }

  const items = data?.items ?? [];
  const showSkeleton = loading && !data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add images</DialogTitle>
          <DialogDescription>
            Pick from the media library or upload new files.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search
              className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by filename…"
              className="pl-8"
              aria-label="Search media"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            Upload
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {showSkeleton ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-md" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
              <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {debouncedQ ? "No images match your search." : "No images in the library yet."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {items.map((item) => {
                const isSelected = selected.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggle(item)}
                    className={`relative aspect-square overflow-hidden rounded-md border transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                      isSelected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-muted-foreground/30"
                    }`}
                    aria-pressed={isSelected}
                    aria-label={`Select ${item.filename}`}
                    title={item.filename}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.alt ?? ""} className="size-full object-cover" />
                    {isSelected ? (
                      <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" aria-hidden />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {data && data.total > 0 ? (
          <TablePagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={confirmSelection} disabled={selected.size === 0}>
            Add {selected.size > 0 ? selected.size : ""}{" "}
            {selected.size === 1 ? "image" : "images"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
