import {
  deleteReview,
  moderateReview,
  moderateReviewSchema,
  notFound,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/reviews/:id — approve or reject. */
export const PATCH = withFeature(
  "reviews",
  withAdminApi({ resource: "reviews", action: "update" }, async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, moderateReviewSchema);

    const review = await moderateReview(id, input.status);

    await writeAudit({
      admin,
      req,
      action: "moderate",
      resource: "review",
      resourceId: id,
      diff: { after: { status: input.status } },
    });

    return ok(review);
  }),
);

/** DELETE /api/admin/reviews/:id — remove a review permanently. */
export const DELETE = withFeature(
  "reviews",
  withAdminApi({ resource: "reviews", action: "delete" }, async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();

    await deleteReview(id);

    await writeAudit({
      admin,
      req,
      action: "delete",
      resource: "review",
      resourceId: id,
    });

    return ok({ deleted: true });
  }),
);
