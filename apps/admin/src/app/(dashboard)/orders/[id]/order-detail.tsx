"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImageIcon, Printer } from "lucide-react";
import { toast } from "sonner";
import type { OrderStatus } from "@repo/core";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate, formatMoney } from "@/lib/format";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "../orders-table";

// ── Wire types (Dates serialized to ISO strings by page.tsx) ─

export type ManualStatus = "fulfilled" | "shipped" | "delivered" | "completed" | "cancelled";

export type SerializedAddress = {
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

export type SerializedOrderItem = {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
};

export type SerializedRefund = {
  id: string;
  amount: number;
  reason: string | null;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
};

export type SerializedPayment = {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "cancelled";
  method: string | null;
  createdAt: string;
  refunds: SerializedRefund[];
};

export type SerializedHistoryEntry = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actor: string;
  note: string | null;
  createdAt: string;
};

export type SerializedOrder = {
  id: string;
  orderNumber: string;
  email: string;
  status: OrderStatus;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  currency: string;
  shippingAddress: SerializedAddress | null;
  billingAddress: SerializedAddress | null;
  shippingRateName: string | null;
  discountCode: string | null;
  notes: string | null;
  createdAt: string;
  items: SerializedOrderItem[];
  statusHistory: SerializedHistoryEntry[];
  payments: SerializedPayment[];
  refundedTotal: number;
  refundableTotal: number;
};

// ── Presentation helpers ─────────────────────────────────────

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const PAYMENT_STATUS_BADGE: Record<SerializedPayment["status"], BadgeVariant> = {
  pending: "secondary",
  processing: "secondary",
  succeeded: "default",
  failed: "destructive",
  cancelled: "outline",
};

const REFUND_STATUS_BADGE: Record<SerializedRefund["status"], BadgeVariant> = {
  pending: "secondary",
  succeeded: "default",
  failed: "destructive",
  cancelled: "outline",
};

const TRANSITION_LABEL: Record<ManualStatus, string> = {
  fulfilled: "Mark as fulfilled",
  shipped: "Mark as shipped",
  delivered: "Mark as delivered",
  completed: "Mark as completed",
  cancelled: "Cancel order",
};

/** "system" / "webhook:stripe" verbatim; anything else is an admin user id. */
function actorLabel(actor: string): string {
  return actor === "system" || actor.startsWith("webhook:") ? actor : "Admin";
}

function truncateId(id: string, max = 20): string {
  return id.length > max ? `${id.slice(0, max)}…` : id;
}

function AddressBlock({ address }: { address: SerializedAddress | null }) {
  if (!address) return <p className="text-sm text-muted-foreground">—</p>;
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  const cityLine = [address.city, address.region, address.postalCode].filter(Boolean).join(", ");
  return (
    <div className="text-sm">
      {name ? <p>{name}</p> : null}
      {address.company ? <p>{address.company}</p> : null}
      <p>{address.line1}</p>
      {address.line2 ? <p>{address.line2}</p> : null}
      <p>{cityLine}</p>
      <p>{address.country}</p>
      {address.phone ? <p className="text-muted-foreground">{address.phone}</p> : null}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────

export function OrderDetailView({
  order,
  allowedNext,
  canWrite,
}: {
  order: SerializedOrder;
  allowedNext: ManualStatus[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [transitionNote, setTransitionNote] = useState("");
  const [transitioning, setTransitioning] = useState<ManualStatus | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  async function transition(status: ManualStatus) {
    setTransitioning(status);
    try {
      await apiFetch(`/api/admin/orders/${order.id}/status`, {
        method: "POST",
        body: {
          status,
          ...(transitionNote.trim() ? { note: transitionNote.trim() } : {}),
        },
      });
      toast.success(`Order moved to ${ORDER_STATUS_LABEL[status].toLowerCase()}`);
      setTransitionNote("");
      router.refresh();
    } catch (err) {
      toast.error("Status update failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setTransitioning(null);
    }
  }

  const showActions = canWrite && (allowedNext.length > 0 || order.refundableTotal > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="icon" asChild aria-label="Back to orders">
              <Link href="/orders">
                <ArrowLeft className="size-4" aria-hidden />
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
            <Badge variant={ORDER_STATUS_BADGE[order.status]}>
              {ORDER_STATUS_LABEL[order.status]}
            </Badge>
          </div>
          <p className="pl-11 text-sm text-muted-foreground">Placed {formatDate(order.createdAt)}</p>
        </div>
        <Button variant="outline" asChild>
          <a href={`/invoice/${order.id}`} target="_blank" rel="noopener noreferrer">
            <Printer className="size-4" aria-hidden />
            Print invoice
          </a>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Main column ── */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="size-12 shrink-0 rounded-md border object-cover"
                    />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted">
                      <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.productTitle}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[item.variantTitle, item.sku ? `SKU ${item.sku}` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p className="text-muted-foreground tabular-nums">
                      {item.quantity} × {formatMoney(item.unitPrice, order.currency)}
                    </p>
                    <p className="font-medium tabular-nums">
                      {formatMoney(item.unitPrice * item.quantity, order.currency)}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatMoney(order.subtotal, order.currency)}</span>
              </div>
              {order.discountTotal !== 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Discount{order.discountCode ? ` (${order.discountCode})` : ""}
                  </span>
                  <span className="tabular-nums">
                    −{formatMoney(order.discountTotal, order.currency)}
                  </span>
                </div>
              ) : null}
              {order.shippingTotal !== 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Shipping{order.shippingRateName ? ` (${order.shippingRateName})` : ""}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(order.shippingTotal, order.currency)}
                  </span>
                </div>
              ) : null}
              {order.taxTotal !== 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="tabular-nums">{formatMoney(order.taxTotal, order.currency)}</span>
                </div>
              ) : null}
              <Separator />
              <div className="flex justify-between font-medium">
                <span>Grand total</span>
                <span className="tabular-nums">{formatMoney(order.grandTotal, order.currency)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                order.payments.map((payment) => (
                  <div key={payment.id} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm" title={payment.stripePaymentIntentId}>
                          {truncateId(payment.stripePaymentIntentId)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(payment.createdAt)}
                          {payment.method ? ` · ${payment.method}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          {formatMoney(payment.amount, payment.currency)}
                        </span>
                        <Badge variant={PAYMENT_STATUS_BADGE[payment.status]} className="capitalize">
                          {payment.status}
                        </Badge>
                      </div>
                    </div>
                    {payment.refunds.length > 0 ? (
                      <ul className="space-y-1 border-l pl-4">
                        {payment.refunds.map((refund) => (
                          <li
                            key={refund.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <span className="text-muted-foreground">
                              Refund · {formatDate(refund.createdAt)}
                              {refund.reason ? ` · ${refund.reason}` : ""}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums">
                                −{formatMoney(refund.amount, payment.currency)}
                              </span>
                              <Badge
                                variant={REFUND_STATUS_BADGE[refund.status]}
                                className="capitalize"
                              >
                                {refund.status}
                              </Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {order.statusHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No status changes yet.</p>
              ) : (
                <ul className="space-y-4">
                  {order.statusHistory.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {entry.fromStatus ? (
                            <>
                              {ORDER_STATUS_LABEL[entry.fromStatus]} →{" "}
                              {ORDER_STATUS_LABEL[entry.toStatus]}
                            </>
                          ) : (
                            ORDER_STATUS_LABEL[entry.toStatus]
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {actorLabel(entry.actor)} · {formatDate(entry.createdAt)}
                        </span>
                      </div>
                      {entry.note ? (
                        <p className="mt-1 text-muted-foreground">{entry.note}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Side column ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm break-all">{order.email}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Addresses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase">Shipping</p>
                <AddressBlock address={order.shippingAddress} />
              </div>
              <Separator />
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase">Billing</p>
                <AddressBlock address={order.billingAddress} />
              </div>
            </CardContent>
          </Card>

          <NotesCard orderId={order.id} initialNotes={order.notes} canWrite={canWrite} />

          {showActions ? (
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {allowedNext.length > 0 ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="transition-note">Note (optional)</Label>
                      <Input
                        id="transition-note"
                        value={transitionNote}
                        onChange={(e) => setTransitionNote(e.target.value)}
                        placeholder="Added to the order timeline"
                        maxLength={1000}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      {allowedNext.map((status) =>
                        status === "cancelled" ? (
                          <Button
                            key={status}
                            variant="destructive"
                            disabled={transitioning !== null}
                            onClick={() => setConfirmCancelOpen(true)}
                          >
                            {TRANSITION_LABEL[status]}
                          </Button>
                        ) : (
                          <Button
                            key={status}
                            variant="outline"
                            disabled={transitioning !== null}
                            onClick={() => void transition(status)}
                          >
                            {TRANSITION_LABEL[status]}
                          </Button>
                        ),
                      )}
                    </div>
                  </>
                ) : null}
                {order.refundableTotal > 0 ? (
                  <>
                    {allowedNext.length > 0 ? <Separator /> : null}
                    <div className="space-y-1">
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={transitioning !== null}
                        onClick={() => setRefundOpen(true)}
                      >
                        Refund…
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {formatMoney(order.refundableTotal, order.currency)} refundable
                      </p>
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
        title={`Cancel order ${order.orderNumber}?`}
        description="The order will be marked as cancelled. This can't be undone — a cancelled order has no further transitions."
        confirmLabel="Cancel order"
        onConfirm={async () => {
          setConfirmCancelOpen(false);
          await transition("cancelled");
        }}
      />

      {refundOpen ? (
        <RefundDialog
          orderId={order.id}
          orderNumber={order.orderNumber}
          currency={order.currency}
          refundableTotal={order.refundableTotal}
          onClose={() => setRefundOpen(false)}
          onDone={() => {
            setRefundOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ── Notes ────────────────────────────────────────────────────

function NotesCard({
  orderId,
  initialNotes,
  canWrite,
}: {
  orderId: string;
  initialNotes: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/orders/${orderId}/notes`, {
        method: "PATCH",
        body: { notes: notes.trim() === "" ? null : notes },
      });
      toast.success("Notes saved");
      router.refresh();
    } catch (err) {
      toast.error("Failed to save notes", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes — never shown to the customer"
          rows={4}
          maxLength={5000}
          disabled={!canWrite}
        />
        {canWrite ? (
          <Button variant="outline" size="sm" onClick={() => void save()} disabled={saving}>
            Save notes
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Refund ───────────────────────────────────────────────────

function RefundDialog({
  orderId,
  orderNumber,
  currency,
  refundableTotal,
  onClose,
  onDone,
}: {
  orderId: string;
  orderNumber: string;
  currency: string;
  refundableTotal: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsed = Number.parseFloat(amount);
  const cents = Number.isNaN(parsed) ? null : Math.round(parsed * 100);
  const invalid = cents === null || cents <= 0 || cents > refundableTotal;

  async function submit() {
    if (invalid || cents === null) {
      toast.error("Enter an amount between 0 and the refundable total");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/orders/${orderId}/refund`, {
        method: "POST",
        body: {
          amount: cents,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      toast.success(`Refunded ${formatMoney(cents, currency)}`);
      onDone();
    } catch (err) {
      toast.error("Refund failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {orderNumber}</DialogTitle>
          <DialogDescription>
            Up to {formatMoney(refundableTotal, currency)} can be refunded to the original payment
            method.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Amount ({currency})</Label>
            <Input
              id="refund-amount"
              type="number"
              min={0.01}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={(refundableTotal / 100).toFixed(2)}
            />
            {cents !== null && cents > refundableTotal ? (
              <p className="text-sm text-destructive">
                Exceeds the refundable amount ({formatMoney(refundableTotal, currency)}).
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Input
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Damaged in transit"
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || invalid}>
            Refund {cents !== null && !invalid ? formatMoney(cents, currency) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
