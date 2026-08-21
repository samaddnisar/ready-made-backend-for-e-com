import { badRequest, listAdjustments, updateInventoryConfig, updateInventoryConfigSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "inventory", action: "read" }, async (req, ctx) => {
  const { variantId } = await ctx.params;
  if (!variantId) throw badRequest("Missing variantId");
  return ok({ adjustments: await listAdjustments(variantId) });
});

export const PATCH = withAdminApi(
  { resource: "inventory", action: "update" },
  async (req, ctx) => {
    const { variantId } = await ctx.params;
    if (!variantId) throw badRequest("Missing variantId");
    const input = await parseBody(req, updateInventoryConfigSchema);
    await updateInventoryConfig(variantId, input);

    await writeAudit({
      admin: ctx.admin,
      req,
      action: "update",
      resource: "inventory",
      resourceId: variantId,
      diff: { after: input },
    });

    return ok({ updated: true });
  },
);
