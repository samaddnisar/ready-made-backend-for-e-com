import {
  adjustBalance,
  getGiftCard,
  giftCardAdminActionSchema,
  notFound,
  setStatus,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/admin/gift-cards/:id — full code + complete balance ledger. */
export const GET = withFeature(
  "gift_cards",
  withAdminApi({ resource: "gift_cards", action: "read" }, async (_req, { params }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    return ok(await getGiftCard(id));
  }),
);

/**
 * PATCH /api/admin/gift-cards/:id — one discriminated action per request:
 * { action: "adjust", delta, note } | { action: "disable" } | { action: "enable" }.
 */
export const PATCH = withFeature(
  "gift_cards",
  withAdminApi({ resource: "gift_cards", action: "update" }, async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, giftCardAdminActionSchema);

    if (input.action === "adjust") {
      const card = await adjustBalance(id, input.delta, input.note, admin.adminUser.id);
      await writeAudit({
        admin,
        req,
        action: "adjust",
        resource: "gift_card",
        resourceId: id,
        diff: { after: { delta: input.delta, note: input.note, balance: card.balance, status: card.status } },
      });
      return ok(card);
    }

    const card = await setStatus(id, input.action === "disable" ? "disabled" : "active");
    await writeAudit({
      admin,
      req,
      action: input.action,
      resource: "gift_card",
      resourceId: id,
      diff: { after: { status: card.status } },
    });
    return ok(card);
  }),
);
