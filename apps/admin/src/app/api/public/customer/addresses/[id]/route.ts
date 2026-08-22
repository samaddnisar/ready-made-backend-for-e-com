import { deleteAddress, notFound, updateAddress, updateAddressSchema, uuidSchema } from "@repo/core";
import { ok, parseBody, withPublicApi } from "@/lib/api";
import { requireCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/** PATCH /api/public/customer/addresses/:id — edit an address (customer-scoped in core). */
export const PATCH = withPublicApi(async (req, ctx) => {
  const customer = await requireCustomer(req);
  const { id } = await ctx.params;
  if (!id || !uuidSchema.safeParse(id).success) throw notFound("Address not found");
  const input = await parseBody(req, updateAddressSchema);
  return ok(await updateAddress(customer.id, id, input));
});

/** DELETE /api/public/customer/addresses/:id — soft-delete an address. */
export const DELETE = withPublicApi(async (req, ctx) => {
  const customer = await requireCustomer(req);
  const { id } = await ctx.params;
  if (!id || !uuidSchema.safeParse(id).success) throw notFound("Address not found");
  await deleteAddress(customer.id, id);
  return ok({ deleted: true });
});
