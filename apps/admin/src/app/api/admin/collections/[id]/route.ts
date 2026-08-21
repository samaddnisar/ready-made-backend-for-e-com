import {
  badRequest,
  getCollectionById,
  softDeleteCollection,
  updateCollection,
  updateCollectionSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "products", action: "read" }, async (_req, { params }) => {
  const { id } = await params;
  if (!id) throw badRequest("Missing id parameter");
  return ok(await getCollectionById(id));
});

export const PATCH = withAdminApi(
  { resource: "products", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id) throw badRequest("Missing id parameter");
    const input = await parseBody(req, updateCollectionSchema);
    const collection = await updateCollection(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "collection",
      resourceId: id,
      diff: { after: { name: collection.name, slug: collection.slug } },
    });

    return ok(collection);
  },
);

export const DELETE = withAdminApi(
  { resource: "products", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id) throw badRequest("Missing id parameter");
    await softDeleteCollection(id);

    await writeAudit({ admin, req, action: "delete", resource: "collection", resourceId: id });

    return ok({ deleted: true });
  },
);
