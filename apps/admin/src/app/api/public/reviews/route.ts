import { submitReview, submitReviewSchema } from "@repo/core";
import { ok, parseBody, withFeature, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";
import { withRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/reviews — submit a product review. Reviews require an
 * account (verified-purchase detection and the one-review-per-product rule
 * both need a customer identity). Lands as "pending" until moderated.
 * 404s entirely when the reviews feature is off.
 */
export const POST = withRateLimit("review-submit", 5, 60_000, withFeature(
  "reviews",
  withPublicApi(async (req) => {
    const customer = await requireCustomer(req);
    const input = await parseBody(req, submitReviewSchema);
    return ok(await submitReview(customer.id, input), { status: 201 });
  }),
));
