import {
  createCmsPage,
  createCmsPageSchema,
  listCmsPagesQuerySchema,
  listPagesAdmin,
} from "@repo/core";
import { ok, parseBody, parseQuery, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withFeature(
  "cms",
  withAdminApi({ resource: "cms", action: "read" }, async (req) => {
    const query = parseQuery(req, listCmsPagesQuerySchema);
    return ok(await listPagesAdmin(query));
  }),
);

export const POST = withFeature(
  "cms",
  withAdminApi({ resource: "cms", action: "create" }, async (req, { admin }) => {
    const input = await parseBody(req, createCmsPageSchema);
    const page = await createCmsPage(input);

    await writeAudit({
      admin,
      req,
      action: "create",
      resource: "cms_page",
      resourceId: page.id,
      diff: { after: input },
    });

    return ok(page);
  }),
);
