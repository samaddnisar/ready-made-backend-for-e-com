import {
  getBlogPostById,
  notFound,
  softDeleteBlogPost,
  updateBlogPost,
  updateBlogPostSchema,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withFeature(
  "cms",
  withAdminApi({ resource: "cms", action: "read" }, async (_req, { params }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    return ok(await getBlogPostById(id));
  }),
);

export const PATCH = withFeature(
  "cms",
  withAdminApi({ resource: "cms", action: "update" }, async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateBlogPostSchema);

    const post = await updateBlogPost(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "blog_post",
      resourceId: id,
      diff: { after: input },
    });

    return ok(post);
  }),
);

export const DELETE = withFeature(
  "cms",
  withAdminApi({ resource: "cms", action: "delete" }, async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();

    await softDeleteBlogPost(id);

    await writeAudit({
      admin,
      req,
      action: "delete",
      resource: "blog_post",
      resourceId: id,
    });

    return ok({ deleted: true });
  }),
);
