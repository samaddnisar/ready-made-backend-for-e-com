import { getOrderDetail, notFound, uuidSchema } from "@repo/core";
import { ok, withAdminApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "orders", action: "read" }, async (_req, { params }) => {
  const { id } = await params;
  if (!id || !uuidSchema.safeParse(id).success) throw notFound();
  return ok(await getOrderDetail(id));
});
