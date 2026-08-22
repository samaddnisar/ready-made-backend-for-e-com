import {
  adminTransitionOrder,
  getCancellablePaymentIntents,
  notFound,
  updateOrderStatusSchema,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { sendOrderEmail } from "@/lib/email";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "orders", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateOrderStatusSchema);

    const result = await adminTransitionOrder(id, input, admin.adminUser.id);
    if (result.email) await sendOrderEmail(result.email, id);

    // Cancelling an order must also kill its live PaymentIntent — the
    // customer's client secret would otherwise remain payable.
    if (input.status === "cancelled") {
      const stripe = getStripe();
      for (const intentId of await getCancellablePaymentIntents(id)) {
        try {
          await stripe.paymentIntents.cancel(intentId);
        } catch (err) {
          console.warn(`[orders] could not cancel PaymentIntent ${intentId}`, err);
        }
      }
    }

    await writeAudit({
      admin,
      req,
      action: "transition",
      resource: "order",
      resourceId: id,
      diff: { after: { status: input.status } },
    });

    return ok(result.order);
  },
);
