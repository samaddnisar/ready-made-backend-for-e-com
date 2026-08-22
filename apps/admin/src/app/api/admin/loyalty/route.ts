import { adminListLoyaltyAccounts, listLoyaltyAccountsQuerySchema } from "@repo/core";
import { ok, parseQuery, withAdminApi, withFeature } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/admin/loyalty — loyalty accounts with customer identity (q filters on email). */
export const GET = withFeature(
  "loyalty",
  withAdminApi({ resource: "loyalty", action: "read" }, async (req) => {
    const query = parseQuery(req, listLoyaltyAccountsQuerySchema);
    return ok(await adminListLoyaltyAccounts(query));
  }),
);
