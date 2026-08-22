"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate, formatMoney } from "@/lib/format";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "../../orders/orders-table";

// ── Wire types (Dates serialized to ISO strings by page.tsx) ─

export type SerializedCustomerAddress = {
  id: string;
  type: "shipping" | "billing";
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
};

export type SerializedCustomerOrder = {
  id: string;
  orderNumber: string;
  status: string;
  grandTotal: number;
  currency: string;
  createdAt: string;
};

export type SerializedCustomer = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  marketingOptIn: boolean;
  notes: string | null;
  createdAt: string;
  orderCount: number;
  lifetimeValue: number;
  addresses: SerializedCustomerAddress[];
  recentOrders: SerializedCustomerOrder[];
};

// ── Presentation helpers ─────────────────────────────────────

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** The service sends status as plain text — fall back gracefully for unknowns. */
function orderStatusLabel(status: string): string {
  return (ORDER_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

function orderStatusBadge(status: string): BadgeVariant {
  return (ORDER_STATUS_BADGE as Record<string, BadgeVariant>)[status] ?? "secondary";
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────

export function CustomerDetailView({
  customer,
  currency,
  canWrite,
  canDelete,
}: {
  customer: SerializedCustomer;
  currency: string;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="icon" asChild aria-label="Back to customers">
              <Link href="/customers">
                <ArrowLeft className="size-4" aria-hidden />
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">{name || customer.email}</h1>
            {customer.marketingOptIn ? <Badge variant="secondary">Marketing opt-in</Badge> : null}
          </div>
          <p className="pl-11 text-sm text-muted-foreground break-all">
            {customer.email} · joined {formatDate(customer.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatChip label="Lifetime value" value={formatMoney(customer.lifetimeValue, currency)} />
          <StatChip
            label="Orders"
            value={String(customer.orderCount)}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Main column ── */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Recent orders</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {customer.recentOrders.length === 0 ? (
                <p className="px-6 text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Order</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="pr-6">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customer.recentOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="pl-6">
                            <Link
                              href={`/orders/${order.id}`}
                              className="font-medium hover:underline"
                            >
                              {order.orderNumber}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant={orderStatusBadge(order.status)}>
                              {orderStatusLabel(order.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatMoney(order.grandTotal, order.currency)}
                          </TableCell>
                          <TableCell className="pr-6 text-muted-foreground">
                            {formatDate(order.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Side column ── */}
        <div className="space-y-6">
          <ProfileCard customer={customer} canWrite={canWrite} />
          <AddressesCard addresses={customer.addresses} />
          <NotesCard customerId={customer.id} initialNotes={customer.notes} canWrite={canWrite} />
          {canDelete ? (
            <DangerCard customerId={customer.id} customerLabel={name || customer.email} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Profile ──────────────────────────────────────────────────

function ProfileCard({
  customer,
  canWrite,
}: {
  customer: SerializedCustomer;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(customer.firstName ?? "");
  const [lastName, setLastName] = useState(customer.lastName ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [marketingOptIn, setMarketingOptIn] = useState(customer.marketingOptIn);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/customers/${customer.id}`, {
        method: "PATCH",
        body: {
          firstName: firstName.trim() === "" ? null : firstName.trim(),
          lastName: lastName.trim() === "" ? null : lastName.trim(),
          phone: phone.trim() === "" ? null : phone.trim(),
          marketingOptIn,
        },
      });
      toast.success("Profile saved");
      router.refresh();
    } catch (err) {
      toast.error("Failed to save profile", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="customer-first-name">First name</Label>
            <Input
              id="customer-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={100}
              disabled={!canWrite}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-last-name">Last name</Label>
            <Input
              id="customer-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={100}
              disabled={!canWrite}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-phone">Phone</Label>
          <Input
            id="customer-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={50}
            disabled={!canWrite}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="customer-marketing" className="font-normal">
            Marketing opt-in
          </Label>
          <Switch
            id="customer-marketing"
            checked={marketingOptIn}
            onCheckedChange={setMarketingOptIn}
            disabled={!canWrite}
          />
        </div>
        {canWrite ? (
          <Button variant="outline" size="sm" onClick={() => void save()} disabled={saving}>
            Save profile
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Addresses (read-only) ────────────────────────────────────

function AddressesCard({ addresses }: { addresses: SerializedCustomerAddress[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Addresses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved addresses.</p>
        ) : (
          addresses.map((address, i) => {
            const addressName = [address.firstName, address.lastName].filter(Boolean).join(" ");
            const cityLine = [address.city, address.region, address.postalCode]
              .filter(Boolean)
              .join(", ");
            return (
              <div key={address.id} className="space-y-2">
                {i > 0 ? <Separator /> : null}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {address.type}
                  </Badge>
                  {address.isDefault ? (
                    <span
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                      title="Default address"
                    >
                      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                      Default
                    </span>
                  ) : null}
                </div>
                <div className="text-sm">
                  {addressName ? <p>{addressName}</p> : null}
                  {address.company ? <p>{address.company}</p> : null}
                  <p>{address.line1}</p>
                  {address.line2 ? <p>{address.line2}</p> : null}
                  <p>{cityLine}</p>
                  <p>{address.country}</p>
                  {address.phone ? <p className="text-muted-foreground">{address.phone}</p> : null}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ── Notes ────────────────────────────────────────────────────

function NotesCard({
  customerId,
  initialNotes,
  canWrite,
}: {
  customerId: string;
  initialNotes: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/customers/${customerId}`, {
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

// ── Danger zone ──────────────────────────────────────────────

function DangerCard({
  customerId,
  customerLabel,
}: {
  customerId: string;
  customerLabel: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/customers/${customerId}`, { method: "DELETE" });
      toast.success("Customer deleted");
      router.push("/customers");
    } catch (err) {
      setDeleting(false);
      toast.error("Failed to delete customer", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    }
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Deleting a customer removes them from the customer list. Their order history is kept.
        </p>
        <Button
          variant="destructive"
          size="sm"
          disabled={deleting}
          onClick={() => setConfirmOpen(true)}
        >
          Delete customer
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${customerLabel}?`}
        description="This is a soft delete: the customer disappears from the admin and their email is freed for reuse, but their orders and order history are kept intact."
        confirmLabel="Delete customer"
        onConfirm={async () => {
          setConfirmOpen(false);
          await remove();
        }}
      />
    </Card>
  );
}
