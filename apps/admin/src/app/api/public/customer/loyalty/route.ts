import { getLoyaltyAccount, loosePaginationQuerySchema } from "@repo/core";
import { ok, parseQuery, withFeature, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/customer/loyalty — the signed-in customer's point balance
 * and paginated ledger, newest first. Loose query schema: public URLs may
 * carry tracking params that must not turn into 422s.
 */
export const GET = withFeature(
  "loyalty",
  withPublicApi(async (req) => {
    const customer = await requireCustomer(req);
    const query = parseQuery(req, loosePaginationQuerySchema);
    return ok(await getLoyaltyAccount(customer.id, query));
  }),
);
