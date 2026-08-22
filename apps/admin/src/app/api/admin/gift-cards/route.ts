import {
  getSettings,
  issueGiftCard,
  issueGiftCardSchema,
  listGiftCards,
  listGiftCardsQuerySchema,
} from "@repo/core";
import { ok, parseBody, parseQuery, withAdminApi, withFeature } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/admin/gift-cards — paginated list (codes masked to last 4). */
export const GET = withFeature(
  "gift_cards",
  withAdminApi({ resource: "gift_cards", action: "read" }, async (req) => {
    const query = parseQuery(req, listGiftCardsQuerySchema);
    return ok(await listGiftCards(query));
  }),
);

/**
 * POST /api/admin/gift-cards — issue a card in the store currency. The
 * response carries the full code (shown once in the UI); the audit log
 * only ever records the masked tail.
 */
export const POST = withFeature(
  "gift_cards",
  withAdminApi({ resource: "gift_cards", action: "create" }, async (req, { admin }) => {
    const input = await parseBody(req, issueGiftCardSchema);
    const settings = await getSettings();

    const card = await issueGiftCard(input, settings.currency);

    await writeAudit({
      admin,
      req,
      action: "issue",
      resource: "gift_card",
      resourceId: card.id,
      diff: {
        after: {
          codeLast4: card.code.slice(-4),
          initialBalance: card.initialBalance,
          currency: card.currency,
          customerId: card.customerId,
          expiresAt: card.expiresAt,
        },
      },
    });

    return ok(card, { status: 201 });
  }),
);
