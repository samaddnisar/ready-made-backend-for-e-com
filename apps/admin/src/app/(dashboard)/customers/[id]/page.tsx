import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCustomerDetail, getSettings, type CustomerDetail } from "@repo/core";
import { AppError } from "@repo/core/errors";
import { uuidSchema } from "@repo/core/validation";
import { can, requireReadPage } from "@/lib/auth";
import { CustomerDetailView, type SerializedCustomer } from "./customer-detail";

export const metadata: Metadata = { title: "Customer" };

/** Wire shape for the client component: Dates → ISO strings. */
function serialize(customer: CustomerDetail): SerializedCustomer {
  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    marketingOptIn: customer.marketingOptIn,
    notes: customer.notes,
    createdAt: customer.createdAt.toISOString(),
    orderCount: customer.orderCount,
    lifetimeValue: customer.lifetimeValue,
    addresses: customer.addresses.map((address) => ({
      id: address.id,
      type: address.type,
      firstName: address.firstName,
      lastName: address.lastName,
      company: address.company,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
      phone: address.phone,
      isDefault: address.isDefault,
    })),
    recentOrders: customer.recentOrders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      grandTotal: order.grandTotal,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
    })),
  };
}

export default async function CustomerPage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const admin = await requireReadPage("customers");
  if (!uuidSchema.safeParse(id).success) notFound();

  let customer: CustomerDetail;
  try {
    customer = await getCustomerDetail(id);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }

  const settings = await getSettings();

  return (
    <CustomerDetailView
      customer={serialize(customer)}
      currency={settings.currency}
      canWrite={can(admin, "customers", "update")}
      canDelete={can(admin, "customers", "delete")}
    />
  );
}
