"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Paginated } from "@repo/core/validation";
import type { AuditLogRow } from "@repo/core";
import { EmptyState } from "@/components/empty-state";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { apiFetch } from "@/lib/client-api";
import { formatDate } from "@/lib/format";

/** Wire shape: dates arrive as ISO strings over JSON. */
type AuditRow = Omit<AuditLogRow, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/**
 * Distinct resource names used across writeAudit call sites. The audit table
 * renders any value it finds — this list only drives the filter dropdown.
 */
const KNOWN_RESOURCES = [
  "product",
  "category",
  "collection",
  "media",
  "settings",
  "order",
  "inventory",
  "discount",
  "shipping_zone",
  "shipping_rate",
  "tax",
  "customer",
  "review",
  "gift_card",
  "loyalty_account",
  "cms_page",
  "blog_post",
  "abandoned_cart",
  "newsletter",
  "admin_user",
  "role",
] as const;

const ALL_RESOURCES = "all";
const PAGE_SIZE = 20;

function actionVariant(action: string): "secondary" | "destructive" | "outline" {
  if (action.includes("delete") || action.includes("remove")) return "destructive";
  if (action.includes("create") || action.includes("add")) return "secondary";
  return "outline";
}

/** Date-only input → ISO datetime covering that local day (start or end). */
function dayToIso(day: string, edge: "start" | "end"): string {
  const time = edge === "start" ? "T00:00:00" : "T23:59:59.999";
  return new Date(`${day}${time}`).toISOString();
}

export function AuditLogClient() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [resource, setResource] = useState<string>(ALL_RESOURCES);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AuditRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<AuditRow | null>(null);

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
    if (resource !== ALL_RESOURCES) params.set("resource", resource);
    if (from) params.set("from", dayToIso(from, "start"));
    if (to) params.set("to", dayToIso(to, "end"));

    setLoading(true);
    apiFetch<Paginated<AuditRow>>(`/api/admin/audit-log?${params.toString()}`, {
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
        toast.error("Failed to load audit log", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
    return () => controller.abort();
  }, [debouncedQ, resource, from, to, page, refreshKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const hasFilters = debouncedQ !== "" || resource !== ALL_RESOURCES || from !== "" || to !== "";
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
            placeholder="Search by resource ID or admin email…"
            className="pl-8"
            aria-label="Search audit log"
          />
        </div>
        <Select
          value={resource}
          onValueChange={(value) => {
            setResource(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter by resource">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_RESOURCES}>All resources</SelectItem>
            {KNOWN_RESOURCES.map((r) => (
              <SelectItem key={r} value={r}>
                {r.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className="w-40"
          aria-label="From date"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className="w-40"
          aria-label="To date"
        />
      </div>

      {showError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load the audit log"
          description="Something went wrong while loading audit entries. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        <EmptyState
          icon={ScrollText}
          title={hasFilters ? "No entries match" : "No audit entries yet"}
          description={
            hasFilters
              ? "Try a different resource, search term or date range."
              : "Every admin mutation is recorded here — entries appear as soon as someone changes something."
          }
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-4 w-36" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-44" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-16 rounded-full" />
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-24" />
                              <Skeleton className="h-3 w-40" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        </TableRow>
                      ))
                    : items.map((entry) => (
                        <TableRow
                          key={entry.id}
                          className="cursor-pointer"
                          onClick={() => setSelected(entry)}
                        >
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </TableCell>
                          <TableCell>
                            {entry.adminEmail ?? (
                              <span className="text-muted-foreground">system</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={actionVariant(entry.action)}>{entry.action}</Badge>
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{entry.resource}</p>
                            {entry.resourceId ? (
                              <p
                                className="max-w-48 truncate text-xs text-muted-foreground"
                                title={entry.resourceId}
                              >
                                {entry.resourceId}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {entry.ip ?? "—"}
                          </TableCell>
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

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.action} · {selected.resource}
                </DialogTitle>
                <DialogDescription>
                  {selected.adminEmail ?? "system"} · {formatDate(selected.createdAt)}
                  {selected.ip ? ` · ${selected.ip}` : ""}
                </DialogDescription>
              </DialogHeader>
              {selected.resourceId ? (
                <p className="text-xs break-all text-muted-foreground">
                  Resource ID: {selected.resourceId}
                </p>
              ) : null}
              {selected.diff ? (
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(selected.diff, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No diff was recorded for this entry.
                </p>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
