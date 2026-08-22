import {
  conflict,
  getAbandonedCartDetail,
  markReminderSent,
  notFound,
  uuidSchema,
} from "@repo/core";
import { ok, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { sendAbandonedCartEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/abandoned-carts/:id/remind — send the recovery reminder
 * email for one abandoned cart, then stamp reminderSentAt. One reminder per
 * cart: a second call 409s.
 */
export const POST = withFeature(
  "abandoned_cart",
  withAdminApi(
    { resource: "abandoned_carts", action: "update" },
    async (req, { params, admin }) => {
      const { id } = await params;
      if (!id || !uuidSchema.safeParse(id).success) throw notFound();

      const detail = await getAbandonedCartDetail(id); // throws notFound when missing
      if (detail.reminderSentAt) throw conflict("A reminder has already been sent for this cart");
      if (!detail.email) throw conflict("No email on record for this cart");

      // Fire-and-forget by contract (never throws, no-ops without RESEND_API_KEY).
      await sendAbandonedCartEmail(id);
      const row = await markReminderSent(id);

      await writeAudit({
        admin,
        req,
        action: "send_reminder",
        resource: "abandoned_cart",
        resourceId: id,
        diff: { after: { email: detail.email, reminderSentAt: row.reminderSentAt } },
      });

      return ok(row);
    },
  ),
);
