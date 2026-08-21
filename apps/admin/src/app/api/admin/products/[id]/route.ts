import {
  badRequest,
  getProductById,
  softDeleteProduct,
  updateProduct,
  updateProductSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "products", action: "read" }, async (_req, { params }) => {
  const { id } = await params;
  if (!id) throw badRequest("Missing id parameter");
  return ok(await getProductById(id));
});

export const PATCH = withAdminApi(
  { resource: "products", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id) throw badRequest("Missing id parameter");
    const input = await parseBody(req, updateProductSchema);
    const product = await updateProduct(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "product",
      resourceId: id,
      diff: { after: { title: product.title, slug: product.slug, status: product.status } },
    });

    return ok(product);
  },
);

export const DELETE = withAdminApi(
  { resource: "products", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id) throw badRequest("Missing id parameter");
    await softDeleteProduct(id);

    await writeAudit({ admin, req, action: "delete", resource: "product", resourceId: id });

    return ok({ deleted: true });
  },
);
