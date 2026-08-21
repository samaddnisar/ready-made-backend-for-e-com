import {
  createProduct,
  createProductSchema,
  listProducts,
  listProductsQuerySchema,
} from "@repo/core";
import { ok, parseBody, parseQuery, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "products", action: "read" }, async (req) => {
  const query = parseQuery(req, listProductsQuerySchema);
  return ok(await listProducts(query));
});

export const POST = withAdminApi(
  { resource: "products", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, createProductSchema);
    const product = await createProduct(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "product",
      resourceId: product.id,
      diff: { after: { title: product.title, slug: product.slug, status: product.status } },
    });

    return ok(product);
  },
);
