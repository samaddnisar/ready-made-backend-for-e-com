import { createCart } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/cart — create a new anonymous cart. The storefront keeps
 * the returned opaque session token client-side and uses it for all
 * subsequent cart calls. No auth.
 */
export const POST = withPublicApi(async () => {
  return ok(await createCart());
});
