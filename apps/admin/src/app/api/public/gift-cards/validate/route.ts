import { validateGiftCard, validateGiftCardSchema } from "@repo/core";
import { ok, parseBody, withFeature, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/gift-cards/validate — check a code before checkout.
 * Valid cards return balance + currency; every invalid outcome (unknown,
 * disabled, depleted, expired) is the identical { valid: false } — no
 * existence oracle, no customer data. 404s when the flag is off (§4).
 */
export const POST = withFeature(
  "gift_cards",
  withPublicApi(async (req) => {
    const input = await parseBody(req, validateGiftCardSchema);
    return ok(await validateGiftCard(input.code));
  }),
);
