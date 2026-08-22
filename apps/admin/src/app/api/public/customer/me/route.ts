import {
  listAddresses,
  updateProfile,
  updateProfileSchema,
  type Address,
  type Customer,
} from "@repo/core";
import { ok, parseBody, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/**
 * Customer-facing profile payload, built explicitly so internal columns
 * (admin `notes`, `deletedAt`, auth linkage) can never leak (§5).
 */
function profilePayload(customer: Customer, addresses: Address[]) {
  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    marketingOptIn: customer.marketingOptIn,
    createdAt: customer.createdAt,
    addresses,
  };
}

/** GET /api/public/customer/me — the signed-in customer's profile + addresses. */
export const GET = withPublicApi(async (req) => {
  const customer = await requireCustomer(req);
  return ok(profilePayload(customer, await listAddresses(customer.id)));
});

/** PATCH /api/public/customer/me — self-service profile edits (no notes). */
export const PATCH = withPublicApi(async (req) => {
  const customer = await requireCustomer(req);
  const input = await parseBody(req, updateProfileSchema);
  const updated = await updateProfile(customer.id, input);
  return ok(profilePayload(updated, await listAddresses(updated.id)));
});
