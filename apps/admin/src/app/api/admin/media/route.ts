import {
  AppError,
  badRequest,
  createMediaRecord,
  listMedia,
  listMediaQuerySchema,
} from "@repo/core";
import { ok, parseQuery, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { createSupabaseAdminClient, MEDIA_BUCKET } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// NO image/svg+xml — SVG can carry scripts and is a stored-XSS vector (§9).
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "application/pdf",
]);

export const GET = withAdminApi({ resource: "media", action: "read" }, async (req) => {
  const query = parseQuery(req, listMediaQuerySchema);
  return ok(await listMedia(query));
});

export const POST = withAdminApi({ resource: "media", action: "create" }, async (req, { admin }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Request body must be multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest('A "file" field is required');
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest("File is too large (max 10 MB)");
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw badRequest(`Unsupported file type "${file.type}"`, {
      allowed: [...ALLOWED_MIME_TYPES],
    });
  }

  const altEntry = form.get("alt");
  const alt = typeof altEntry === "string" && altEntry.length > 0 ? altEntry : null;
  if (alt && alt.length > 300) throw badRequest("alt must be 300 characters or fewer");

  // Image optimization (§9): re-encode still images to capped-size WebP so
  // multi-MB camera uploads never ship raw to storefront visitors. GIFs keep
  // their animation, video/PDF pass through untouched. Also yields intrinsic
  // width/height for layout stability.
  let body: File | Buffer = file;
  let contentType = file.type;
  let filename = file.name;
  let sizeBytes = file.size;
  let width: number | null = null;
  let height: number | null = null;
  const optimizable = file.type.startsWith("image/") && file.type !== "image/gif";
  if (optimizable) {
    try {
      const { default: sharp } = await import("sharp");
      const input = Buffer.from(await file.arrayBuffer());
      const optimized = await sharp(input)
        .rotate() // honor EXIF orientation
        .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      body = optimized.data;
      contentType = "image/webp";
      filename = file.name.replace(/\.[a-zA-Z0-9]+$/, "") + ".webp";
      sizeBytes = optimized.info.size;
      width = optimized.info.width;
      height = optimized.info.height;
    } catch (err) {
      // Optimization is best-effort — a decode failure falls back to the original bytes.
      console.warn("[media] image optimization failed, storing original", err);
    }
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "") || "file";
  const path = `${year}/${month}/${crypto.randomUUID()}-${sanitized}`;

  const supabase = createSupabaseAdminClient();
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (uploadError) {
    const hint = /bucket/i.test(uploadError.message)
      ? ` — create a public "${MEDIA_BUCKET}" bucket in Supabase Storage`
      : "";
    throw new AppError("internal_error", `Upload failed: ${uploadError.message}${hint}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);

  const item = await createMediaRecord({
    url: publicUrl,
    storagePath: path,
    filename,
    mimeType: contentType,
    sizeBytes,
    alt,
    width,
    height,
    uploadedBy: admin.adminUser.id,
  });

  await writeAudit({
    admin,
    req,
    action: "create",
    resource: "media",
    resourceId: item.id,
    diff: { after: { filename: item.filename, mimeType: item.mimeType, sizeBytes: item.sizeBytes } },
  });

  return ok(item);
});
