import { listCustomers, listCustomersQuerySchema } from "@repo/core";
import { ok, parseQuery, withAdminApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "customers", action: "read" }, async (req) => {
  const query = parseQuery(req, listCustomersQuerySchema);
  return ok(await listCustomers(query));
});
