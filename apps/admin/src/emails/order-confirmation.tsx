import type { CSSProperties } from "react";
import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { OrderEmailData } from "../lib/email";

/** Integer minor units → "USD 25.00". No Intl in email templates. */
function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export default function OrderConfirmationEmail({ data }: { data: OrderEmailData }) {
  const totals: { label: string; value: string; bold?: boolean }[] = [
    { label: "Subtotal", value: money(data.subtotal, data.currency) },
  ];
  if (data.discountTotal !== 0) {
    totals.push({ label: "Discount", value: `-${money(data.discountTotal, data.currency)}` });
  }
  if (data.shippingTotal !== 0) {
    totals.push({ label: "Shipping", value: money(data.shippingTotal, data.currency) });
  }
  if (data.taxTotal !== 0) {
    totals.push({ label: "Tax", value: money(data.taxTotal, data.currency) });
  }

  const address = data.shippingAddress;
  const addressName = address
    ? [address.firstName, address.lastName].filter(Boolean).join(" ")
    : "";
  const cityLine = address
    ? [address.city, address.region, address.postalCode].filter(Boolean).join(", ")
    : "";

  return (
    <Html>
      <Head />
      <Preview>{`Order ${data.orderNumber} confirmed — thanks for shopping with ${data.storeName}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading as="h1" style={storeHeading}>
            {data.storeName}
          </Heading>
          <Text style={meta}>
            Order {data.orderNumber} · {formatDate(data.createdAt)}
          </Text>

          <Heading as="h2" style={subHeading}>
            Thanks for your order
          </Heading>
          <Text style={paragraph}>
            We&apos;ve received your order and are getting it ready. Here&apos;s a summary of what
            you purchased.
          </Text>

          <Hr style={divider} />

          <Section>
            <Row>
              <Column style={itemHeaderCell}>Item</Column>
              <Column style={qtyHeaderCell}>Qty</Column>
              <Column style={totalHeaderCell}>Total</Column>
            </Row>
            {data.items.map((item, i) => (
              <Row key={i}>
                <Column style={itemCell}>
                  <Text style={itemTitle}>{item.title}</Text>
                  {item.variantTitle ? <Text style={itemVariant}>{item.variantTitle}</Text> : null}
                </Column>
                <Column style={qtyCell}>{item.quantity}</Column>
                <Column style={totalCell}>{money(item.lineTotal, data.currency)}</Column>
              </Row>
            ))}
          </Section>

          <Hr style={divider} />

          <Section>
            {totals.map((line) => (
              <Row key={line.label}>
                <Column style={totalsLabelCell}>{line.label}</Column>
                <Column style={totalsValueCell}>{line.value}</Column>
              </Row>
            ))}
            <Row>
              <Column style={grandTotalLabelCell}>Total</Column>
              <Column style={grandTotalValueCell}>{money(data.grandTotal, data.currency)}</Column>
            </Row>
          </Section>

          {address ? (
            <>
              <Hr style={divider} />
              <Section>
                <Heading as="h3" style={sectionHeading}>
                  Shipping to
                </Heading>
                {addressName ? <Text style={addressLine}>{addressName}</Text> : null}
                {address.company ? <Text style={addressLine}>{address.company}</Text> : null}
                <Text style={addressLine}>{address.line1}</Text>
                {address.line2 ? <Text style={addressLine}>{address.line2}</Text> : null}
                {cityLine ? <Text style={addressLine}>{cityLine}</Text> : null}
                <Text style={addressLine}>{address.country}</Text>
              </Section>
            </>
          ) : null}

          <Hr style={divider} />
          <Text style={footer}>
            {data.supportEmail
              ? `Questions about your order? Contact us at ${data.supportEmail}.`
              : `This email was sent by ${data.storeName}.`}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "24px 0",
};

const container: CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px",
};

const storeHeading: CSSProperties = {
  color: "#18181b",
  fontSize: "20px",
  fontWeight: 700,
  margin: "0 0 4px",
};

const meta: CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  margin: "0 0 24px",
};

const subHeading: CSSProperties = {
  color: "#18181b",
  fontSize: "16px",
  fontWeight: 600,
  margin: "0 0 8px",
};

const sectionHeading: CSSProperties = {
  color: "#18181b",
  fontSize: "14px",
  fontWeight: 600,
  margin: "0 0 8px",
};

const paragraph: CSSProperties = {
  color: "#3f3f46",
  fontSize: "14px",
  lineHeight: "22px",
  margin: 0,
};

const divider: CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "20px 0",
};

const headerCellBase: CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  fontWeight: 600,
  paddingBottom: "8px",
  textTransform: "uppercase" as const,
};

const itemHeaderCell: CSSProperties = { ...headerCellBase, textAlign: "left", width: "60%" };
const qtyHeaderCell: CSSProperties = { ...headerCellBase, textAlign: "center", width: "15%" };
const totalHeaderCell: CSSProperties = { ...headerCellBase, textAlign: "right", width: "25%" };

const itemCell: CSSProperties = {
  paddingBottom: "8px",
  textAlign: "left",
  verticalAlign: "top",
  width: "60%",
};

const itemTitle: CSSProperties = {
  color: "#18181b",
  fontSize: "14px",
  margin: 0,
};

const itemVariant: CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  margin: 0,
};

const qtyCell: CSSProperties = {
  color: "#3f3f46",
  fontSize: "14px",
  paddingBottom: "8px",
  textAlign: "center",
  verticalAlign: "top",
  width: "15%",
};

const totalCell: CSSProperties = {
  color: "#18181b",
  fontSize: "14px",
  paddingBottom: "8px",
  textAlign: "right",
  verticalAlign: "top",
  width: "25%",
};

const totalsLabelCell: CSSProperties = {
  color: "#71717a",
  fontSize: "14px",
  paddingBottom: "4px",
  textAlign: "left",
};

const totalsValueCell: CSSProperties = {
  color: "#3f3f46",
  fontSize: "14px",
  paddingBottom: "4px",
  textAlign: "right",
};

const grandTotalLabelCell: CSSProperties = {
  color: "#18181b",
  fontSize: "15px",
  fontWeight: 700,
  paddingTop: "8px",
  textAlign: "left",
};

const grandTotalValueCell: CSSProperties = {
  color: "#18181b",
  fontSize: "15px",
  fontWeight: 700,
  paddingTop: "8px",
  textAlign: "right",
};

const addressLine: CSSProperties = {
  color: "#3f3f46",
  fontSize: "14px",
  lineHeight: "20px",
  margin: 0,
};

const footer: CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};
