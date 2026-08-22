import { notFound, removeWishlistItem, uuidSchema } from "@repo/core";
import { ok, withFeature, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/** DELETE /api/public/customer/wishlist/:productId — remove a saved product. */
export const DELETE = withFeature(
  "wishlists",
  withPublicApi(async (req, ctx) => {
    const customer = await requireCustomer(req);
    const { productId } = await ctx.params;
    if (!productId || !uuidSchema.safeParse(productId).success) {
      throw notFound("Wishlist item not found");
    }
    await removeWishlistItem(customer.id, productId);
    return ok({ removed: true });
  }),
);
