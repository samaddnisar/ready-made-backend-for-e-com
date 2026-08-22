import {
  newsletterSubscribeSchema,
  newsletterUnsubscribeSchema,
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
} from "@repo/core";
import { ok, parseBody, withFeature, withPublicApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/newsletter — subscribe. Idempotent and oracle-free: the
 * response is always { subscribed: true }, whether the email was new, already
 * subscribed, or previously unsubscribed (reactivated). 404s when the flag
 * is off (§4).
 */
export const POST = withFeature(
  "newsletter",
  withPublicApi(async (req) => {
    const input = await parseBody(req, newsletterSubscribeSchema);
    await subscribeToNewsletter(input.email, input.source);
    return ok({ subscribed: true });
  }),
);

/**
 * DELETE /api/public/newsletter — unsubscribe. Always { subscribed: false },
 * even for emails that were never subscribed — no existence leak.
 */
export const DELETE = withFeature(
  "newsletter",
  withPublicApi(async (req) => {
    const input = await parseBody(req, newsletterUnsubscribeSchema);
    await unsubscribeFromNewsletter(input.email);
    return ok({ subscribed: false });
  }),
);
