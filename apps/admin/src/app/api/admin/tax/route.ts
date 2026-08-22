import { getTaxSettings, updateTaxSettings, updateTaxSettingsSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi({ resource: "tax", action: "read" }, async () => {
  return ok(await getTaxSettings());
});

export const PATCH = withAdminApi(
  { resource: "tax", action: "update" },
  async (req, { admin }) => {
    const input = await parseBody(req, updateTaxSettingsSchema);
    const settings = await updateTaxSettings(input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "tax",
      resourceId: String(settings.id),
      diff: { after: input },
    });

    return ok(settings);
  },
);
