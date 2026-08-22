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
import type { AbandonedCartEmailData } from "../lib/email";

/** Integer minor units → "USD 25.00". No Intl in email templates. */
function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export default function AbandonedCartEmail({ data }: { data: AbandonedCartEmailData }) {
  return (
    <Html>
      <Head />
      <Preview>{`You left items in your cart at ${data.storeName} — they're still saved for you`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading as="h1" style={storeHeading}>
            {data.storeName}
          </Heading>

          <Heading as="h2" style={subHeading}>
            You left something behind
          </Heading>
          <Text style={paragraph}>
            Your cart is still saved — here&apos;s what&apos;s waiting for you.
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
            <Row>
              <Column style={grandTotalLabelCell}>Cart total</Column>
              <Column style={grandTotalValueCell}>{money(data.cartValue, data.currency)}</Column>
            </Row>
          </Section>

          <Hr style={divider} />

          <Text style={paragraph}>
            {data.supportEmail
              ? `Ready to finish your order? Head back to the store to check out, or contact us at ${data.supportEmail} and we'll help you complete your purchase.`
              : `Ready to finish your order? Head back to the store to check out — your cart is waiting.`}
          </Text>

          <Hr style={divider} />
          <Text style={footer}>
            {data.supportEmail
              ? `Questions? Contact us at ${data.supportEmail}.`
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
  margin: "0 0 24px",
};

const subHeading: CSSProperties = {
  color: "#18181b",
  fontSize: "16px",
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

const grandTotalLabelCell: CSSProperties = {
  color: "#18181b",
  fontSize: "15px",
  fontWeight: 700,
  textAlign: "left",
};

const grandTotalValueCell: CSSProperties = {
  color: "#18181b",
  fontSize: "15px",
  fontWeight: 700,
  textAlign: "right",
};

const footer: CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};
