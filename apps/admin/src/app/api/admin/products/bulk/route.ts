import { bulkProductAction, bulkProductActionSchema, forbidden, hasPermission } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAdminApi(
  { resource: "products", action: "update" },
  async (req, { admin }) => {
    const input = await parseBody(req, bulkProductActionSchema);
    // Bulk delete additionally requires the delete grant — "update" alone
    // must not be enough to soft-delete products in bulk.
    if (input.action === "delete" && !hasPermission(admin.permissions, "products", "delete")) {
      throw forbidden();
    }

    const affected = await bulkProductAction(input.ids, input.action);

    await writeAudit({
      admin,
      req,
      action: input.action === "delete" ? "delete" : "update",
      resource: "product",
      diff: { after: { bulkAction: input.action, ids: input.ids, affected } },
    });

    return ok({ affected });
  },
);
