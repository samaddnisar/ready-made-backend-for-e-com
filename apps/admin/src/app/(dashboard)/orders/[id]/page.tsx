import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ADMIN_MANUAL_TRANSITIONS,
  ORDER_TRANSITIONS,
  getOrderDetail,
  type OrderDetail,
} from "@repo/core";
import { AppError } from "@repo/core/errors";
import { uuidSchema } from "@repo/core/validation";
import { can, requireReadPage } from "@/lib/auth";
import { OrderDetailView, type ManualStatus, type SerializedOrder } from "./order-detail";

export const metadata: Metadata = { title: "Order" };

/** Wire shape for the client component: Dates → ISO strings. */
function serialize(order: OrderDetail): SerializedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    email: order.email,
    status: order.status,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    currency: order.currency,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    shippingRateName: order.shippingRateName,
    discountCode: order.discountCode,
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      sku: item.sku,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
    })),
    statusHistory: order.statusHistory.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actor: entry.actor,
      note: entry.note,
      createdAt: entry.createdAt.toISOString(),
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      createdAt: payment.createdAt.toISOString(),
      refunds: payment.refunds.map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status,
        createdAt: refund.createdAt.toISOString(),
      })),
    })),
    refundedTotal: order.refundedTotal,
    refundableTotal: order.refundableTotal,
  };
}

export default async function OrderPage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const admin = await requireReadPage("orders");
  if (!uuidSchema.safeParse(id).success) notFound();

  let order: OrderDetail;
  try {
    order = await getOrderDetail(id);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }

  // Only the manual transitions that are legal from the order's current status.
  const allowedNext = ORDER_TRANSITIONS[order.status].filter((s): s is ManualStatus =>
    ADMIN_MANUAL_TRANSITIONS.includes(s),
  );

  return (
    <OrderDetailView
      order={serialize(order)}
      allowedNext={allowedNext}
      canWrite={can(admin, "orders", "update")}
    />
  );
}
