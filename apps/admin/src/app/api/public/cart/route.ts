import { createCart } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";
import { withRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/cart — create a new anonymous cart. The storefront keeps
 * the returned opaque session token client-side and uses it for all
 * subsequent cart calls. No auth.
 */
export const POST = withRateLimit("cart-create", 20, 60_000, withPublicApi(async () => {
  return ok(await createCart());
}));
