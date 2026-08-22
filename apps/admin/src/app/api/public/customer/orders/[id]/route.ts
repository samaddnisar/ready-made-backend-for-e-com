import { getCustomerOrder, notFound, uuidSchema } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/customer/orders/:id — order detail, scoped to the owning
 * customer in core (others' orders 404) with internal notes stripped.
 */
export const GET = withPublicApi(async (req, ctx) => {
  const customer = await requireCustomer(req);
  const { id } = await ctx.params;
  if (!id || !uuidSchema.safeParse(id).success) throw notFound("Order not found");
  return ok(await getCustomerOrder(customer.id, id));
});
