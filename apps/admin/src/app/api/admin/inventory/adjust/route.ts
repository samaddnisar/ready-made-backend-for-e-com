import { adjustStock, adjustStockSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "inventory", action: "update" },
  async (req, { admin }) => {
    const input = await parseBody(req, adjustStockSchema);
    const result = await adjustStock(input, admin.adminUser.id);

    await writeAudit({
      admin,
      req,
      action: "adjust_stock",
      resource: "inventory",
      resourceId: input.variantId,
      diff: { after: { delta: input.delta, reason: input.reason, quantity: result.quantity } },
    });

    return ok(result);
  },
);
