import "server-only";

import { createElement, type ReactElement } from "react";
import { Resend } from "resend";
import { getOrderDetail, getSettings } from "@repo/core";
import OrderConfirmationEmail from "../emails/order-confirmation";
import OrderShippedEmail from "../emails/order-shipped";
import PaymentFailedEmail from "../emails/payment-failed";

export type OrderEmailKind = "order_confirmation" | "order_shipped" | "payment_failed";

/** Address snapshot passed to templates — plain serializable data only. */
export type OrderEmailAddress = {
  firstName?: string;
  lastName?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
};

export type OrderEmailItem = {
  title: string;
  variantTitle: string | null;
  quantity: number;
  /** unitPrice × quantity, integer minor units. */
  lineTotal: number;
};

/**
 * Everything a template needs, as plain serializable data — templates never
 * import server code (they may `import type` from here; types erase at build).
 * All money fields are integer minor units (cents).
 */
export type OrderEmailData = {
  orderNumber: string;
  /** ISO 8601 timestamp of order creation. */
  createdAt: string;
  storeName: string;
  supportEmail: string | null;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  items: OrderEmailItem[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  shippingAddress: OrderEmailAddress | null;
};

const SUBJECTS: Record<OrderEmailKind, (orderNumber: string) => string> = {
  order_confirmation: (n) => `Order ${n} confirmed`,
  order_shipped: (n) => `Your order ${n} has shipped`,
  payment_failed: (n) => `Payment failed for order ${n}`,
};

const TEMPLATES: Record<OrderEmailKind, (props: { data: OrderEmailData }) => ReactElement> = {
  order_confirmation: OrderConfirmationEmail,
  order_shipped: OrderShippedEmail,
  payment_failed: PaymentFailedEmail,
};

let _resend: Resend | undefined;

/**
 * Send a transactional order email. Fire-and-forget by contract: it NEVER
 * throws — failures are logged — and it no-ops with a warning when
 * RESEND_API_KEY is unset, so the money path can't be broken by email.
 */
export async function sendOrderEmail(kind: OrderEmailKind, orderId: string): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn(`[email] RESEND_API_KEY is not set — skipping ${kind} for order ${orderId}`);
      return;
    }

    const [order, settings] = await Promise.all([getOrderDetail(orderId), getSettings()]);

    const emailConfig = settings.emailConfig;
    const fromAddress = emailConfig?.fromAddress?.trim();
    const from = fromAddress
      ? emailConfig?.fromName
        ? `${emailConfig.fromName} <${fromAddress}>`
        : fromAddress
      : process.env.EMAIL_FROM;
    if (!from) {
      console.error(
        `[email] No from-address configured (settings.emailConfig.fromAddress or EMAIL_FROM) — skipping ${kind} for order ${orderId}`,
      );
      return;
    }

    const data: OrderEmailData = {
      orderNumber: order.orderNumber,
      createdAt: order.createdAt.toISOString(),
      storeName: settings.storeName,
      supportEmail: settings.storeEmail ?? null,
      currency: order.currency,
      items: order.items.map((item) => ({
        title: item.productTitle,
        variantTitle: item.variantTitle ?? null,
        quantity: item.quantity,
        lineTotal: item.unitPrice * item.quantity,
      })),
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      shippingTotal: order.shippingTotal,
      taxTotal: order.taxTotal,
      grandTotal: order.grandTotal,
      shippingAddress: order.shippingAddress ?? null,
    };

    _resend ??= new Resend(apiKey);
    const { error } = await _resend.emails.send({
      from,
      to: order.email,
      ...(emailConfig?.replyTo ? { replyTo: emailConfig.replyTo } : {}),
      subject: SUBJECTS[kind](order.orderNumber),
      react: createElement(TEMPLATES[kind], { data }),
    });
    if (error) {
      console.error(`[email] Resend rejected ${kind} for order ${orderId}:`, error);
    }
  } catch (err) {
    console.error(`[email] Failed to send ${kind} for order ${orderId}:`, err);
  }
}
