import {
  createDiscount,
  createDiscountSchema,
  listDiscounts,
  listDiscountsQuerySchema,
} from "@repo/core";
import { ok, parseBody, parseQuery, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "discounts", action: "read" }, async (req) => {
  const query = parseQuery(req, listDiscountsQuerySchema);
  return ok(await listDiscounts(query));
});

export const POST = withAdminApi(
  { resource: "discounts", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, createDiscountSchema);
    const discount = await createDiscount(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "discount",
      resourceId: discount.id,
      diff: { after: { code: discount.code, type: discount.type, value: discount.value } },
    });

    return ok(discount);
  },
);
