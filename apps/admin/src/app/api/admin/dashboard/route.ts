import { z } from "zod";
import { getDashboardStats } from "@repo/core";
import { ok, parseQuery, withAdminApi } from "@/lib/api";

export const dynamic = "force-dynamic";

const querySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

/** Dashboard stats (§7) — defaults to the last 30 days. */
export const GET = withAdminApi({ resource: "dashboard", action: "read" }, async (req) => {
  const query = parseQuery(req, querySchema);
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
  return ok(await getDashboardStats({ from, to }));
});
