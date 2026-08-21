import { createCategory, createCategorySchema, listCategories } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "products", action: "read" }, async () => {
  return ok(await listCategories());
});

export const POST = withAdminApi(
  { resource: "products", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, createCategorySchema);
    const category = await createCategory(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "category",
      resourceId: category.id,
      diff: { after: { name: category.name, slug: category.slug } },
    });

    return ok(category);
  },
);
