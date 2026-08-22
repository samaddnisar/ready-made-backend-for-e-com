import { z } from "zod";
import { cartTokenSchema, getCartShippingBasis, resolveShippingRates } from "@repo/core";
import { ok, parseQuery, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  /** ISO 3166-1 alpha-2 destination country. */
  country: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/),
  cartToken: cartTokenSchema,
});

/**
 * GET /api/public/shipping-rates?country=US&cartToken=…
 * Rates available for the destination given the cart's contents. The
 * storefront shows these at checkout; the chosen id goes into POST /checkout.
 */
export const GET = withPublicApi(async (req) => {
  const query = parseQuery(req, querySchema);
  const basis = await getCartShippingBasis(query.cartToken);
  const rates = await resolveShippingRates(query.country, basis);
  return ok({ rates });
});
