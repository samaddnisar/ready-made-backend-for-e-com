import { addressInputSchema, createAddress, listAddresses } from "@repo/core";
import { ok, parseBody, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/** GET /api/public/customer/addresses — the customer's address book. */
export const GET = withPublicApi(async (req) => {
  const customer = await requireCustomer(req);
  return ok(await listAddresses(customer.id));
});

/**
 * POST /api/public/customer/addresses — add an address. `isDefault: true`
 * demotes the previous default of the same type (handled in core).
 */
export const POST = withPublicApi(async (req) => {
  const customer = await requireCustomer(req);
  const input = await parseBody(req, addressInputSchema);
  return ok(await createAddress(customer.id, input));
});
