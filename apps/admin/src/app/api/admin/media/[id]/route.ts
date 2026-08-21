import { badRequest, deleteMediaRecord, updateMediaAlt, updateMediaSchema } from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { createSupabaseAdminClient, MEDIA_BUCKET } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const PATCH = withAdminApi(
  { resource: "media", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id) throw badRequest("Missing id parameter");
    const input = await parseBody(req, updateMediaSchema);
    const item = await updateMediaAlt(id, input.alt);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "media",
      resourceId: id,
      diff: { after: { alt: item.alt } },
    });

    return ok(item);
  },
);

export const DELETE = withAdminApi(
  { resource: "media", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id) throw badRequest("Missing id parameter");

    // DB record first (throws notFound if missing) …
    const record = await deleteMediaRecord(id);

    // … then the storage object. The record is already gone, so a storage
    // failure is logged but never fails the request.
    try {
      const supabase = createSupabaseAdminClient();
      const { error: removeError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .remove([record.storagePath]);
      if (removeError) {
        console.error("[media] failed to remove storage object", record.storagePath, removeError);
      }
    } catch (err) {
      console.error("[media] failed to remove storage object", record.storagePath, err);
    }

    await writeAudit({
      admin,
      req,
      action: "delete",
      resource: "media",
      resourceId: id,
      diff: { before: { filename: record.filename, storagePath: record.storagePath } },
    });

    return ok({ deleted: true });
  },
);
