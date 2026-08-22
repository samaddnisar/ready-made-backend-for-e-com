import {
  AppError,
  beginRefund,
  createRefundSchema,
  finalizeRefund,
  notFound,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "orders", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, createRefundSchema);

    // Race-safe: beginRefund locks the order, re-validates the refundable
    // amount under the lock, and inserts the local row BEFORE money moves —
    // two concurrent requests can't both pass the check.
    const { refund, payment } = await beginRefund(
      id,
      { amount: input.amount, reason: input.reason },
      admin.adminUser.id,
    );

    let stripeRefund;
    try {
      stripeRefund = await getStripe().refunds.create(
        { payment_intent: payment.stripePaymentIntentId, amount: input.amount },
        // §9: keyed on our local row — a network retry dedupes at Stripe.
        { idempotencyKey: `refund-${refund.id}` },
      );
    } catch (err) {
      // The reservation row is marked failed so it stops counting against
      // the refundable amount.
      await finalizeRefund(refund.id, { status: "failed" }, admin.adminUser.id);
      throw new AppError(
        "payment_error",
        err instanceof Error ? err.message : "Stripe refund failed",
      );
    }

    const finalized = await finalizeRefund(
      refund.id,
      {
        stripeRefundId: stripeRefund.id,
        status: stripeRefund.status === "succeeded" ? "succeeded" : "pending",
      },
      admin.adminUser.id,
    );

    await writeAudit({
      admin,
      req,
      action: "refund",
      resource: "order",
      resourceId: id,
      diff: { after: { amount: input.amount, reason: input.reason } },
    });

    return ok(finalized);
  },
);
