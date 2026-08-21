import { listOrders, listOrdersQuerySchema } from "@repo/core";
import { ok, parseQuery, withAdminApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "orders", action: "read" }, async (req) => {
  const query = parseQuery(req, listOrdersQuerySchema);
  return ok(await listOrders(query));
});
