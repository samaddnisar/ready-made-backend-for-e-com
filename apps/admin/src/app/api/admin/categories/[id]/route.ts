import { badRequest, notFound, softDeleteCategory, updateCategory, updateCategorySchema, uuidSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const PATCH = withAdminApi(
  { resource: "products", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateCategorySchema);
    const category = await updateCategory(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "category",
      resourceId: id,
      diff: { after: { name: category.name, slug: category.slug } },
    });

    return ok(category);
  },
);

export const DELETE = withAdminApi(
  { resource: "products", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    await softDeleteCategory(id);

    await writeAudit({ admin, req, action: "delete", resource: "category", resourceId: id });

    return ok({ deleted: true });
  },
);
