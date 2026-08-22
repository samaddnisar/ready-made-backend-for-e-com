import {
  createBlogPost,
  createBlogPostSchema,
  listBlogPostsQuerySchema,
  listPostsAdmin,
} from "@repo/core";
import { ok, parseBody, parseQuery, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withFeature(
  "cms",
  withAdminApi({ resource: "cms", action: "read" }, async (req) => {
    const query = parseQuery(req, listBlogPostsQuerySchema);
    return ok(await listPostsAdmin(query));
  }),
);

export const POST = withFeature(
  "cms",
  withAdminApi({ resource: "cms", action: "create" }, async (req, { admin }) => {
    const input = await parseBody(req, createBlogPostSchema);
    const post = await createBlogPost(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "blog_post",
      resourceId: post.id,
      diff: { after: input },
    });

    return ok(post);
  }),
);
