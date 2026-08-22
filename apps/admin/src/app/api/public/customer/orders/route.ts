import { listCustomerOrders, loosePaginationQuerySchema } from "@repo/core";
import { ok, parseQuery, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/customer/orders — the signed-in customer's order history,
 * newest first, paginated. Loose query schema: public URLs may carry
 * tracking params that must not turn into 422s.
 */
export const GET = withPublicApi(async (req) => {
  const customer = await requireCustomer(req);
  const query = parseQuery(req, loosePaginationQuerySchema);
  return ok(await listCustomerOrders(customer.id, query));
});
