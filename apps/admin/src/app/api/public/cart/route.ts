import { createCart } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";
import { optionalCustomer } from "@/lib/customer-auth";
import { withRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/cart — create a new cart. The storefront keeps the
 * returned opaque session token client-side and uses it for all subsequent
 * cart calls. A signed-in customer's cart is linked to their account
 * (per-customer discount limits, abandoned-cart email resolution).
 */
export const POST = withRateLimit("cart-create", 20, 60_000, withPublicApi(async (req) => {
  const customer = await optionalCustomer(req);
  return ok(await createCart(customer?.id));
}));
