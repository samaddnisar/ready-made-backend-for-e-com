import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderDetail, getSettings, type OrderDetail } from "@repo/core";
import { AppError } from "@repo/core/errors";
import { uuidSchema } from "@repo/core/validation";
import { requireReadPage } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Invoice" };

const INVOICE_STYLES = `
  .invoice-page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem;
    color: #111;
    background: #fff;
    font-size: 14px;
    line-height: 1.5;
  }
  .invoice-page table { width: 100%; border-collapse: collapse; }
  .invoice-page th, .invoice-page td { padding: 0.5rem 0.25rem; text-align: left; }
  .invoice-page th { border-bottom: 1px solid #ccc; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
  .invoice-page tbody td { border-bottom: 1px solid #eee; vertical-align: top; }
  .invoice-page .num { text-align: right; font-variant-numeric: tabular-nums; }
  .invoice-muted { color: #555; }
  @media print {
    .print-hint { display: none; }
    body { background: #fff; }
    .invoice-page { padding: 0; }
  }
  @page { margin: 1.6cm; }
`;

type OrderAddress = NonNullable<OrderDetail["shippingAddress"]>;

function AddressLines({ address }: { address: OrderAddress | null }) {
  if (!address) return <p className="invoice-muted">—</p>;
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  const cityLine = [address.city, address.region, address.postalCode].filter(Boolean).join(", ");
  return (
    <p>
      {name ? (
        <>
          {name}
          <br />
        </>
      ) : null}
      {address.company ? (
        <>
          {address.company}
          <br />
        </>
      ) : null}
      {address.line1}
      <br />
      {address.line2 ? (
        <>
          {address.line2}
          <br />
        </>
      ) : null}
      {cityLine}
      <br />
      {address.country}
      {address.phone ? (
        <>
          <br />
          {address.phone}
        </>
      ) : null}
    </p>
  );
}

export default async function InvoicePage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await requireReadPage("orders");
  if (!uuidSchema.safeParse(id).success) notFound();

  let order: OrderDetail;
  try {
    order = await getOrderDetail(id);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }

  const settings = await getSettings();

  return (
    <main className="invoice-page">
      <style>{INVOICE_STYLES}</style>

      <p
        className="print-hint"
        style={{
          marginBottom: "1.5rem",
          padding: "0.5rem 0.75rem",
          border: "1px solid #ddd",
          borderRadius: "0.375rem",
          color: "#555",
          fontSize: "13px",
        }}
      >
        Use your browser&apos;s print function (Ctrl/Cmd&nbsp;+&nbsp;P) to print or save this
        invoice as a PDF. This hint won&apos;t appear on the printout.
      </p>

      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>{settings.storeName}</h1>
          {settings.storeAddress ? (
            <p className="invoice-muted">
              {[
                settings.storeAddress.line1,
                settings.storeAddress.line2,
                [
                  settings.storeAddress.city,
                  settings.storeAddress.region,
                  settings.storeAddress.postalCode,
                ]
                  .filter(Boolean)
                  .join(", "),
                settings.storeAddress.country,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {settings.storeEmail ? <p className="invoice-muted">{settings.storeEmail}</p> : null}
          {settings.storePhone ? <p className="invoice-muted">{settings.storePhone}</p> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Invoice</h2>
          <p>{order.orderNumber}</p>
          <p className="invoice-muted">{formatDate(order.createdAt)}</p>
        </div>
      </header>

      <section
        style={{
          display: "flex",
          gap: "2rem",
          marginBottom: "2rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: "12rem" }}>
          <h3 style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Ship to
          </h3>
          <AddressLines address={order.shippingAddress} />
        </div>
        <div style={{ flex: 1, minWidth: "12rem" }}>
          <h3 style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Bill to
          </h3>
          <AddressLines address={order.billingAddress} />
        </div>
        <div style={{ flex: 1, minWidth: "12rem" }}>
          <h3 style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Customer
          </h3>
          <p>{order.email}</p>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>SKU</th>
            <th className="num">Qty</th>
            <th className="num">Unit price</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.productTitle}
                {item.variantTitle ? (
                  <>
                    <br />
                    <span className="invoice-muted">{item.variantTitle}</span>
                  </>
                ) : null}
              </td>
              <td className="invoice-muted">{item.sku ?? "—"}</td>
              <td className="num">{item.quantity}</td>
              <td className="num">{formatMoney(item.unitPrice, order.currency)}</td>
              <td className="num">{formatMoney(item.unitPrice * item.quantity, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "1.5rem",
        }}
      >
        <table style={{ maxWidth: "18rem" }}>
          <tbody>
            <tr>
              <td className="invoice-muted">Subtotal</td>
              <td className="num">{formatMoney(order.subtotal, order.currency)}</td>
            </tr>
            {order.discountTotal !== 0 ? (
              <tr>
                <td className="invoice-muted">
                  Discount{order.discountCode ? ` (${order.discountCode})` : ""}
                </td>
                <td className="num">−{formatMoney(order.discountTotal, order.currency)}</td>
              </tr>
            ) : null}
            {order.shippingTotal !== 0 ? (
              <tr>
                <td className="invoice-muted">
                  Shipping{order.shippingRateName ? ` (${order.shippingRateName})` : ""}
                </td>
                <td className="num">{formatMoney(order.shippingTotal, order.currency)}</td>
              </tr>
            ) : null}
            {order.taxTotal !== 0 ? (
              <tr>
                <td className="invoice-muted">Tax</td>
                <td className="num">{formatMoney(order.taxTotal, order.currency)}</td>
              </tr>
            ) : null}
            <tr>
              <td style={{ fontWeight: 700, borderTop: "1px solid #ccc" }}>Grand total</td>
              <td className="num" style={{ fontWeight: 700, borderTop: "1px solid #ccc" }}>
                {formatMoney(order.grandTotal, order.currency)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer style={{ marginTop: "3rem" }} className="invoice-muted">
        <p>
          Thank you for your order. Questions? Contact{" "}
          {settings.storeEmail ?? settings.storeName}.
        </p>
      </footer>
    </main>
  );
}
