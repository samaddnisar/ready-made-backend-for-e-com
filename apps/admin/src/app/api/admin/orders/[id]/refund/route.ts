import {
  AppError,
  badRequest,
  createRefundSchema,
  getRefundContext,
  notFound,
  recordRefund,
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

    const ctx = await getRefundContext(id);
    if (input.amount > ctx.refundableTotal) {
      throw badRequest(`Amount exceeds refundable ${ctx.refundableTotal}`);
    }

    let stripeRefund;
    try {
      stripeRefund = await getStripe().refunds.create({
        payment_intent: ctx.payment.stripePaymentIntentId,
        amount: input.amount,
      });
    } catch (err) {
      throw new AppError(
        "payment_error",
        err instanceof Error ? err.message : "Stripe refund failed",
      );
    }

    const refund = await recordRefund(
      ctx.payment.id,
      {
        amount: input.amount,
        reason: input.reason,
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

    return ok(refund);
  },
);
