import { getSettings, updateSettings, updateSettingsSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const GET = withAdminApi({ resource: "settings", action: "read" }, async () => {
  const settings = await getSettings();
  return ok(settings);
});

export const PATCH = withAdminApi({ resource: "settings", action: "update" }, async (req, { admin }) => {
  const input = await parseBody(req, updateSettingsSchema);
  const before = await getSettings();
  const after = await updateSettings(input);

  await writeAudit({
    admin,
    req,
    action: "update",
    resource: "settings",
    resourceId: "1",
    diff: {
      before: Object.fromEntries(Object.keys(input).map((k) => [k, (before as any)[k]])),
      after: Object.fromEntries(Object.keys(input).map((k) => [k, (after as any)[k]])),
    },
  });

  return ok(after);
});
