import { listAuditLog, listAuditLogQuerySchema } from "@repo/core";
import { ok, parseQuery, withAdminApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "audit_log", action: "read" }, async (req) => {
  const query = parseQuery(req, listAuditLogQuerySchema);
  return ok(await listAuditLog(query));
});
