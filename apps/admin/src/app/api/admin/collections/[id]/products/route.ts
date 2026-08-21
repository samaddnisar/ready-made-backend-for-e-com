import { badRequest, notFound, setCollectionProducts, setCollectionProductsSchema, uuidSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const PUT = withAdminApi(
  { resource: "products", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, setCollectionProductsSchema);
    await setCollectionProducts(id, input.productIds);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "collection",
      resourceId: id,
      diff: { after: { productCount: input.productIds.length } },
    });

    return ok({ updated: true });
  },
);
