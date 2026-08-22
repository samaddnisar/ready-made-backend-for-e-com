import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { customers, giftCards, giftCardTransactions } from "../db/schema";
import {
  adjustBalance,
  getGiftCard,
  issueGiftCard,
  listGiftCards,
  setStatus,
  validateGiftCard,
} from "./gift-cards";

let db: Db;

const CODE_RE = /^GC-[A-HJ-NP-Z2-9]{16}$/; // no 0/O/1/I

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(giftCardTransactions);
  await db.delete(giftCards);
  await db.delete(customers);
});

describe("issueGiftCard", () => {
  it("creates an active card with a well-formed code and the initial-load ledger row", async () => {
    const card = await issueGiftCard({ initialBalance: 5000 }, "USD");

    expect(card.code).toMatch(CODE_RE);
    expect(card.initialBalance).toBe(5000);
    expect(card.balance).toBe(5000);
    expect(card.currency).toBe("USD");
    expect(card.status).toBe("active");

    const ledger = await db
      .select()
      .from(giftCardTransactions)
      .where(eq(giftCardTransactions.giftCardId, card.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.delta).toBe(5000);
    expect(ledger[0]!.note).toBe("Initial load");
  });

  it("generates distinct codes and passes a custom note into the ledger", async () => {
    const a = await issueGiftCard({ initialBalance: 100, note: "Birthday promo" }, "USD");
    const b = await issueGiftCard({ initialBalance: 100 }, "USD");
    expect(a.code).not.toBe(b.code);

    const ledger = await db
      .select()
      .from(giftCardTransactions)
      .where(eq(giftCardTransactions.giftCardId, a.id));
    expect(ledger[0]!.note).toBe("Birthday promo");
  });

  it("rejects an unknown customer and a past expiry", async () => {
    await expect(
      issueGiftCard(
        { initialBalance: 100, customerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        "USD",
      ),
    ).rejects.toThrow(/customer not found/i);
    await expect(
      issueGiftCard({ initialBalance: 100, expiresAt: "2000-01-01T00:00:00Z" }, "USD"),
    ).rejects.toThrow(/expiry/i);
  });

  it("links a card to an existing customer", async () => {
    const [customer] = await db.insert(customers).values({ email: "jane@example.com" }).returning();
    const card = await issueGiftCard({ initialBalance: 100, customerId: customer!.id }, "USD");
    expect(card.customerId).toBe(customer!.id);
  });
});

describe("adjustBalance", () => {
  it("floors at zero: an over-deduction is rejected and changes nothing", async () => {
    const card = await issueGiftCard({ initialBalance: 1000 }, "USD");

    await expect(adjustBalance(card.id, -1500, "oops")).rejects.toThrow(/negative/);

    const after = await getGiftCard(card.id);
    expect(after.balance).toBe(1000);
    expect(after.status).toBe("active");
    expect(after.transactions).toHaveLength(1); // only the initial load
  });

  it("flips to depleted at exactly zero and back to active when reloaded", async () => {
    const card = await issueGiftCard({ initialBalance: 1000 }, "USD");

    const drained = await adjustBalance(card.id, -1000, "Used in store");
    expect(drained.balance).toBe(0);
    expect(drained.status).toBe("depleted");

    const reloaded = await adjustBalance(card.id, 500, "Goodwill credit");
    expect(reloaded.balance).toBe(500);
    expect(reloaded.status).toBe("active");

    const detail = await getGiftCard(card.id);
    expect(detail.transactions).toHaveLength(3);
    expect(detail.transactions.map((t) => t.delta).sort((a, b) => a - b)).toEqual([
      -1000, 500, 1000,
    ]);
  });

  it("rejects a zero delta and keeps a disabled card disabled", async () => {
    const card = await issueGiftCard({ initialBalance: 1000 }, "USD");
    await expect(adjustBalance(card.id, 0, "noop")).rejects.toThrow(/non-zero/);

    await setStatus(card.id, "disabled");
    const adjusted = await adjustBalance(card.id, 100, "Load while disabled");
    expect(adjusted.status).toBe("disabled");
    expect(adjusted.balance).toBe(1100);
  });

  it("404s for an unknown card", async () => {
    await expect(
      adjustBalance("dddddddd-dddd-4ddd-8ddd-dddddddddddd", 100, "ghost"),
    ).rejects.toThrow(/not found/i);
  });
});

describe("setStatus", () => {
  it("re-enabling a zero-balance card lands on depleted, not active", async () => {
    const card = await issueGiftCard({ initialBalance: 500 }, "USD");
    await adjustBalance(card.id, -500, "Spent");
    await setStatus(card.id, "disabled");

    const enabled = await setStatus(card.id, "active");
    expect(enabled.status).toBe("depleted");
  });

  it("re-enabling a funded card returns it to active", async () => {
    const card = await issueGiftCard({ initialBalance: 500 }, "USD");
    await setStatus(card.id, "disabled");
    const enabled = await setStatus(card.id, "active");
    expect(enabled.status).toBe("active");
  });
});

describe("validateGiftCard", () => {
  it("returns balance + currency for an active, unexpired card", async () => {
    const card = await issueGiftCard({ initialBalance: 2500 }, "USD");
    const result = await validateGiftCard(card.code);
    expect(result).toEqual({ valid: true, balance: 2500, currency: "USD", status: "active" });
  });

  it("normalizes case and whitespace", async () => {
    const card = await issueGiftCard({ initialBalance: 2500 }, "USD");
    const result = await validateGiftCard(`  ${card.code.toLowerCase()}  `);
    expect(result.valid).toBe(true);
  });

  it("never throws for unknown or malformed codes and returns the constant invalid shape", async () => {
    await expect(validateGiftCard("GC-DOESNOTEXIST9999")).resolves.toEqual({ valid: false });
    await expect(validateGiftCard("")).resolves.toEqual({ valid: false });
    await expect(validateGiftCard("   ")).resolves.toEqual({ valid: false });
    await expect(validateGiftCard("'; drop table gift_cards; --")).resolves.toEqual({
      valid: false,
    });
  });

  it("disabled, depleted and expired cards are invalid with the same shape", async () => {
    const disabled = await issueGiftCard({ initialBalance: 1000 }, "USD");
    await setStatus(disabled.id, "disabled");
    await expect(validateGiftCard(disabled.code)).resolves.toEqual({ valid: false });

    const depleted = await issueGiftCard({ initialBalance: 1000 }, "USD");
    await adjustBalance(depleted.id, -1000, "Spent");
    await expect(validateGiftCard(depleted.code)).resolves.toEqual({ valid: false });

    const expired = await issueGiftCard({ initialBalance: 1000 }, "USD");
    await db
      .update(giftCards)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(giftCards.id, expired.id));
    await expect(validateGiftCard(expired.code)).resolves.toEqual({ valid: false });
  });

  it("never exposes customer info", async () => {
    const [customer] = await db.insert(customers).values({ email: "jane@example.com" }).returning();
    const card = await issueGiftCard({ initialBalance: 1000, customerId: customer!.id }, "USD");
    const result = await validateGiftCard(card.code);
    expect(JSON.stringify(result)).not.toContain("jane@example.com");
    expect(JSON.stringify(result)).not.toContain(customer!.id);
  });
});

describe("listGiftCards / getGiftCard", () => {
  it("masks codes in the list but returns the full code + ledger on detail", async () => {
    const card = await issueGiftCard({ initialBalance: 1000 }, "USD");

    const list = await listGiftCards({ page: 1, pageSize: 20 });
    expect(list.total).toBe(1);
    const item = list.items[0]!;
    expect(item.maskedCode).toBe(`GC-••••${card.code.slice(-4)}`);
    expect(item).not.toHaveProperty("code");
    expect(JSON.stringify(list)).not.toContain(card.code);

    const detail = await getGiftCard(card.id);
    expect(detail.code).toBe(card.code);
    expect(detail.transactions).toHaveLength(1);
  });

  it("filters by status and searches by code", async () => {
    const a = await issueGiftCard({ initialBalance: 1000 }, "USD");
    const b = await issueGiftCard({ initialBalance: 1000 }, "USD");
    await setStatus(b.id, "disabled");

    const active = await listGiftCards({ page: 1, pageSize: 20, status: "active" });
    expect(active.items.map((i) => i.id)).toEqual([a.id]);

    const byCode = await listGiftCards({ page: 1, pageSize: 20, q: a.code });
    expect(byCode.items.map((i) => i.id)).toEqual([a.id]);
  });
});
