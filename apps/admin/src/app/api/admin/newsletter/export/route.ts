import { NextResponse } from "next/server";
import { exportActiveNewsletterCsv } from "@repo/core";
import { withAdminApi, withFeature } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/newsletter/export — active subscribers as a CSV download
 * (columns: email,subscribedAt). Read-only, {newsletter:read}, feature-gated.
 *
 * Deliberately NOT the JSON `{ data }` envelope (§8): this endpoint is a
 * file download consumed by the browser via a plain <a href> — the response
 * body must be the raw text/csv bytes with a Content-Disposition attachment
 * header so the browser saves it as a file. Errors thrown before this point
 * (auth/RBAC/flag-off) still return the standard JSON error envelope via
 * the wrappers.
 */
export const GET = withFeature(
  "newsletter",
  withAdminApi({ resource: "newsletter", action: "read" }, async () => {
    const csv = await exportActiveNewsletterCsv();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="newsletter-subscribers.csv"',
        "Cache-Control": "no-store",
      },
    });
  }),
);
