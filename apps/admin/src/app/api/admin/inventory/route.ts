import { listInventory, listInventoryQuerySchema } from "@repo/core";
import { ok, parseQuery, withAdminApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "inventory", action: "read" }, async (req) => {
  const query = parseQuery(req, listInventoryQuerySchema);
  return ok(await listInventory(query));
});
