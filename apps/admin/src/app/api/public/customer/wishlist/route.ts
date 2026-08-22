import { addWishlistItem, addWishlistItemSchema, getWishlistView } from "@repo/core";
import { ok, parseBody, withFeature, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/** GET /api/public/customer/wishlist — the customer's wishlist with live product info. */
export const GET = withFeature(
  "wishlists",
  withPublicApi(async (req) => {
    const customer = await requireCustomer(req);
    return ok(await getWishlistView(customer.id));
  }),
);

/**
 * POST /api/public/customer/wishlist — save a product (optionally pinning a
 * variant). Idempotent: re-saving an already-saved product is a no-op.
 */
export const POST = withFeature(
  "wishlists",
  withPublicApi(async (req) => {
    const customer = await requireCustomer(req);
    const input = await parseBody(req, addWishlistItemSchema);
    return ok(await addWishlistItem(customer.id, input));
  }),
);
