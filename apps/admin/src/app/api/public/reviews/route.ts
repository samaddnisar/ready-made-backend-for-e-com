import { submitReview, submitReviewSchema } from "@repo/core";
import { ok, parseBody, withFeature, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/reviews — submit a product review. Reviews require an
 * account (verified-purchase detection and the one-review-per-product rule
 * both need a customer identity). Lands as "pending" until moderated.
 * 404s entirely when the reviews feature is off.
 */
export const POST = withFeature(
  "reviews",
  withPublicApi(async (req) => {
    const customer = await requireCustomer(req);
    const input = await parseBody(req, submitReviewSchema);
    return ok(await submitReview(customer.id, input), { status: 201 });
  }),
);
