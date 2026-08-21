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

export default function OrderShippedEmail({ data }: { data: OrderEmailData }) {
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
      <Preview>{`Order ${data.orderNumber} has shipped — it's on its way`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading as="h1" style={storeHeading}>
            {data.storeName}
          </Heading>
          <Text style={meta}>Order {data.orderNumber}</Text>

          <Heading as="h2" style={subHeading}>
            Your order is on its way
          </Heading>
          <Text style={paragraph}>
            Good news — your order {data.orderNumber} has shipped. Here&apos;s what&apos;s in the
            package.
          </Text>

          <Hr style={divider} />

          <Section>
            {data.items.map((item, i) => (
              <Row key={i}>
                <Column style={itemCell}>
                  <Text style={itemTitle}>
                    {item.title}
                    {item.variantTitle ? ` — ${item.variantTitle}` : ""}
                  </Text>
                </Column>
                <Column style={qtyCell}>×{item.quantity}</Column>
                <Column style={totalCell}>{money(item.lineTotal, data.currency)}</Column>
              </Row>
            ))}
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

const qtyCell: CSSProperties = {
  color: "#71717a",
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
