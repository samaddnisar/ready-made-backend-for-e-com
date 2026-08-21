import {
  addCartItem,
  addCartItemSchema,
  cartTokenSchema,
  notFound,
  updateCartItems,
  updateCartItemsSchema,
} from "@repo/core";
import { ok, parseBody, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/cart/:token/items — add a variant to the cart (merges
 * into an existing line for the same variant). Returns the updated cart.
 */
export const POST = withPublicApi(async (req, ctx) => {
  const { token } = await ctx.params;
  if (!token || !cartTokenSchema.safeParse(token).success) throw notFound("Cart not found");
  const input = await parseBody(req, addCartItemSchema);
  return ok(await addCartItem(token, input));
});

/**
 * PATCH /api/public/cart/:token/items — set line quantities (0 removes the
 * line; unknown variants become new lines). Returns the updated cart.
 */
export const PATCH = withPublicApi(async (req, ctx) => {
  const { token } = await ctx.params;
  if (!token || !cartTokenSchema.safeParse(token).success) throw notFound("Cart not found");
  const input = await parseBody(req, updateCartItemsSchema);
  return ok(await updateCartItems(token, input));
});
