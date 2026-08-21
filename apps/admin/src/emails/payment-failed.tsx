import type { CSSProperties } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import type { OrderEmailData } from "../lib/email";

/** Integer minor units → "USD 25.00". No Intl in email templates. */
function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export default function PaymentFailedEmail({ data }: { data: OrderEmailData }) {
  return (
    <Html>
      <Head />
      <Preview>{`Payment failed for order ${data.orderNumber} — please try again`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading as="h1" style={storeHeading}>
            {data.storeName}
          </Heading>
          <Text style={meta}>Order {data.orderNumber}</Text>

          <Heading as="h2" style={subHeading}>
            Payment failed
          </Heading>
          <Text style={paragraph}>
            Unfortunately we couldn&apos;t process the payment of{" "}
            {money(data.grandTotal, data.currency)} for order {data.orderNumber}. You have not been
            charged.
          </Text>
          <Text style={paragraph}>
            Please return to the store and try again — a different payment method often does the
            trick.
          </Text>

          <Hr style={divider} />
          <Text style={footer}>
            {data.supportEmail
              ? `Need a hand? Contact us at ${data.supportEmail}.`
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

const paragraph: CSSProperties = {
  color: "#3f3f46",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 12px",
};

const divider: CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "20px 0",
};

const footer: CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};
