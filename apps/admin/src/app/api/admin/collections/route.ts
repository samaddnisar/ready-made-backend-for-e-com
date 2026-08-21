import { createCollection, createCollectionSchema, listCollections } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "products", action: "read" }, async () => {
  return ok(await listCollections());
});

export const POST = withAdminApi(
  { resource: "products", action: "create" },
  async (req, { admin }) => {
    const input = await parseBody(req, createCollectionSchema);
    const collection = await createCollection(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "collection",
      resourceId: collection.id,
      diff: { after: { name: collection.name, slug: collection.slug } },
    });

    return ok(collection);
  },
);
