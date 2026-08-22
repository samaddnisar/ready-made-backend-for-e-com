import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { newsletterSubscribers } from "../db/schema";
import {
  exportActiveNewsletterCsv,
  exportActiveNewsletterEmails,
  listNewsletterSubscribers,
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
} from "./newsletter";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(newsletterSubscribers);
});

describe("subscribeToNewsletter", () => {
  it("creates an active subscriber with a lowercased email and source", async () => {
    const row = await subscribeToNewsletter("Jane@Example.COM", "storefront_footer");
    expect(row.email).toBe("jane@example.com");
    expect(row.isActive).toBe(true);
    expect(row.unsubscribedAt).toBeNull();
    expect(row.source).toBe("storefront_footer");
  });

  it("is idempotent for an existing active subscriber (same row, no duplicate)", async () => {
    const first = await subscribeToNewsletter("jane@example.com", "storefront_footer");
    const again = await subscribeToNewsletter("JANE@EXAMPLE.com", "checkout");

    expect(again.id).toBe(first.id);
    expect(again.isActive).toBe(true);
    // Active rows are untouched — original signup metadata is preserved.
    expect(again.source).toBe("storefront_footer");
    expect(again.subscribedAt.getTime()).toBe(first.subscribedAt.getTime());

    const all = await db.select().from(newsletterSubscribers);
    expect(all).toHaveLength(1);
  });

  it("reactivates a previously unsubscribed email in place", async () => {
    const first = await subscribeToNewsletter("jane@example.com");
    await unsubscribeFromNewsletter("jane@example.com");

    const back = await subscribeToNewsletter("Jane@example.com", "checkout");
    expect(back.id).toBe(first.id);
    expect(back.isActive).toBe(true);
    expect(back.unsubscribedAt).toBeNull();
    expect(back.source).toBe("checkout");
    expect(back.subscribedAt.getTime()).toBeGreaterThanOrEqual(first.subscribedAt.getTime());

    const all = await db.select().from(newsletterSubscribers);
    expect(all).toHaveLength(1);
  });
});

describe("unsubscribeFromNewsletter", () => {
  it("deactivates and stamps unsubscribedAt, case-insensitively", async () => {
    await subscribeToNewsletter("jane@example.com");
    await unsubscribeFromNewsletter("JANE@Example.com");

    const [row] = await db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, "jane@example.com"));
    expect(row!.isActive).toBe(false);
    expect(row!.unsubscribedAt).not.toBeNull();
  });

  it("silently succeeds for unknown emails (no existence oracle)", async () => {
    await expect(unsubscribeFromNewsletter("ghost@example.com")).resolves.toBeUndefined();
    expect(await db.select().from(newsletterSubscribers)).toHaveLength(0);
  });

  it("is idempotent — a repeat unsubscribe keeps the original timestamp", async () => {
    await subscribeToNewsletter("jane@example.com");
    await unsubscribeFromNewsletter("jane@example.com");
    const [first] = await db.select().from(newsletterSubscribers);

    await unsubscribeFromNewsletter("jane@example.com");
    const [second] = await db.select().from(newsletterSubscribers);
    expect(second!.unsubscribedAt!.getTime()).toBe(first!.unsubscribedAt!.getTime());
  });
});

describe("listNewsletterSubscribers", () => {
  it("filters by q and active, and reports the unfiltered active count", async () => {
    await subscribeToNewsletter("jane@example.com");
    await subscribeToNewsletter("bob@shop.test");
    await subscribeToNewsletter("gone@example.com");
    await unsubscribeFromNewsletter("gone@example.com");

    const all = await listNewsletterSubscribers({ page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.activeCount).toBe(2);

    const active = await listNewsletterSubscribers({ page: 1, pageSize: 10, active: true });
    expect(active.total).toBe(2);
    expect(active.items.every((s) => s.isActive)).toBe(true);

    const inactive = await listNewsletterSubscribers({ page: 1, pageSize: 10, active: false });
    expect(inactive.total).toBe(1);
    expect(inactive.items[0]!.email).toBe("gone@example.com");
    // The stat stays global even when the list itself is filtered.
    expect(inactive.activeCount).toBe(2);

    const searched = await listNewsletterSubscribers({ page: 1, pageSize: 10, q: "example.com" });
    expect(searched.total).toBe(2);
  });
});

describe("export", () => {
  it("exports only active emails and a well-formed CSV", async () => {
    await subscribeToNewsletter("jane@example.com");
    await subscribeToNewsletter("bob@shop.test");
    await unsubscribeFromNewsletter("bob@shop.test");

    expect(await exportActiveNewsletterEmails()).toEqual(["jane@example.com"]);

    const csv = await exportActiveNewsletterCsv();
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("email,subscribedAt");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^jane@example\.com,\d{4}-\d{2}-\d{2}T/);
  });
});
