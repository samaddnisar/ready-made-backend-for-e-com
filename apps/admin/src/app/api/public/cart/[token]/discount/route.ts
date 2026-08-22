import { type NextRequest } from "next/server";
import {
  applyCartDiscount,
  applyDiscountSchema,
  cartTokenSchema,
  notFound,
  removeCartDiscount,
} from "@repo/core";
import { ok, parseBody, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

async function validToken(params: Promise<Record<string, string>>): Promise<string> {
  const { token } = await params;
  if (!token || !cartTokenSchema.safeParse(token).success) throw notFound();
  return token;
}

/** Apply a discount code to the cart. */
export const POST = withPublicApi(async (req: NextRequest, ctx) => {
  const token = await validToken(ctx.params);
  const input = await parseBody(req, applyDiscountSchema);
  return ok(await applyCartDiscount(token, input.code));
});

/** Remove one code (?code=SAVE10) or all codes. */
export const DELETE = withPublicApi(async (req: NextRequest, ctx) => {
  const token = await validToken(ctx.params);
  const code = req.nextUrl.searchParams.get("code") ?? undefined;
  return ok(await removeCartDiscount(token, code));
});
