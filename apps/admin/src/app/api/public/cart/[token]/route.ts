import { cartTokenSchema, getCartByToken, notFound } from "@repo/core";
import { ok, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/cart/:token — current cart contents. The token is the
 * cart's opaque session token (not a uuid); malformed tokens 404 like
 * unknown ones so the shape leaks nothing.
 */
export const GET = withPublicApi(async (_req, ctx) => {
  const { token } = await ctx.params;
  if (!token || !cartTokenSchema.safeParse(token).success) throw notFound("Cart not found");
  return ok(await getCartByToken(token));
});
