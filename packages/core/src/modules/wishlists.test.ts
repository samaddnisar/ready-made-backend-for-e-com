import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import {
  customers,
  inventory,
  products,
  productVariants,
  wishlistItems,
  wishlists,
} from "../db/schema";
import {
  addWishlistItem,
  adminWishlistSummary,
  getOrCreateWishlist,
  getWishlistView,
  removeWishlistItem,
} from "./wishlists";

let db: Db;

let slugCounter = 0;

async function mkCustomer(email: string) {
  const [row] = await db.insert(customers).values({ email }).returning();
  return row!;
}

async function mkProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const [row] = await db
    .insert(products)
    .values({
      title: "Tee",
      slug: `tee-${slugCounter++}`,
      status: "active",
      ...overrides,
    })
    .returning();
  return row!;
}

async function mkVariant(productId: string, price = 1000) {
  const [row] = await db.insert(productVariants).values({ productId, price }).returning();
  return row!;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(wishlistItems);
  await db.delete(wishlists);
  await db.delete(inventory);
  await db.delete(productVariants);
  await db.delete(products);
  await db.delete(customers);
});

describe("getOrCreateWishlist", () => {
  it("creates a default wishlist once and reuses it", async () => {
    const customer = await mkCustomer("jane@example.com");
    const first = await getOrCreateWishlist(customer.id);
    expect(first.name).toBe("Wishlist");

    const again = await getOrCreateWishlist(customer.id);
    expect(again.id).toBe(first.id);

    const rows = await db.select().from(wishlists).where(eq(wishlists.customerId, customer.id));
    expect(rows).toHaveLength(1);
  });
});

describe("addWishlistItem", () => {
  it("adds a product and is idempotent on re-add", async () => {
    const customer = await mkCustomer("jane@example.com");
    const product = await mkProduct();

    const first = await addWishlistItem(customer.id, { productId: product.id });
    const second = await addWishlistItem(customer.id, { productId: product.id });
    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(wishlistItems)
      .where(eq(wishlistItems.productId, product.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects unknown, draft and soft-deleted products", async () => {
    const customer = await mkCustomer("jane@example.com");
    const draft = await mkProduct({ status: "draft" });
    const deleted = await mkProduct({ deletedAt: new Date() });

    await expect(
      addWishlistItem(customer.id, { productId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    ).rejects.toThrow(/not found/i);
    await expect(addWishlistItem(customer.id, { productId: draft.id })).rejects.toThrow(
      /not found/i,
    );
    await expect(addWishlistItem(customer.id, { productId: deleted.id })).rejects.toThrow(
      /not found/i,
    );
  });

  it("rejects a variant that belongs to a different product", async () => {
    const customer = await mkCustomer("jane@example.com");
    const productA = await mkProduct();
    const productB = await mkProduct();
    const variantB = await mkVariant(productB.id);

    await expect(
      addWishlistItem(customer.id, { productId: productA.id, variantId: variantB.id }),
    ).rejects.toThrow(/variant/i);

    const pinned = await addWishlistItem(customer.id, {
      productId: productB.id,
      variantId: variantB.id,
    });
    expect(pinned.variantId).toBe(variantB.id);
  });
});

describe("removeWishlistItem", () => {
  it("removes a saved product and 404s when it isn't saved", async () => {
    const customer = await mkCustomer("jane@example.com");
    const product = await mkProduct();
    await addWishlistItem(customer.id, { productId: product.id });

    await removeWishlistItem(customer.id, product.id);
    const rows = await db
      .select()
      .from(wishlistItems)
      .where(eq(wishlistItems.productId, product.id));
    expect(rows).toHaveLength(0);

    await expect(removeWishlistItem(customer.id, product.id)).rejects.toThrow(/not found/i);
  });

  it("only removes from the caller's own wishlist", async () => {
    const jane = await mkCustomer("jane@example.com");
    const bob = await mkCustomer("bob@example.com");
    const product = await mkProduct();
    await addWishlistItem(jane.id, { productId: product.id });

    await expect(removeWishlistItem(bob.id, product.id)).rejects.toThrow(/not found/i);
    const rows = await db
      .select()
      .from(wishlistItems)
      .where(eq(wishlistItems.productId, product.id));
    expect(rows).toHaveLength(1);
  });
});

describe("getWishlistView", () => {
  it("returns product info and hides deleted or unpublished products", async () => {
    const customer = await mkCustomer("jane@example.com");
    const kept = await mkProduct({ title: "Kept" });
    await mkVariant(kept.id, 1500);
    await mkVariant(kept.id, 2500);
    const doomed = await mkProduct({ title: "Doomed" });
    const unpublished = await mkProduct({ title: "Unpublished" });

    await addWishlistItem(customer.id, { productId: kept.id });
    await addWishlistItem(customer.id, { productId: doomed.id });
    await addWishlistItem(customer.id, { productId: unpublished.id });

    await db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, doomed.id));
    await db.update(products).set({ status: "draft" }).where(eq(products.id, unpublished.id));

    const view = await getWishlistView(customer.id);
    expect(view.name).toBe("Wishlist");
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      productId: kept.id,
      title: "Kept",
      slug: kept.slug,
      minPrice: 1500,
      inStock: true, // no inventory rows = untracked = purchasable
    });
  });

  it("reflects tracked stock (out when every variant is depleted)", async () => {
    const customer = await mkCustomer("jane@example.com");
    const product = await mkProduct();
    const variant = await mkVariant(product.id);
    await db
      .insert(inventory)
      .values({ variantId: variant.id, quantity: 0, trackInventory: true });

    await addWishlistItem(customer.id, { productId: product.id });
    const out = await getWishlistView(customer.id);
    expect(out.items[0]!.inStock).toBe(false);

    await db.update(inventory).set({ quantity: 3 }).where(eq(inventory.variantId, variant.id));
    const back = await getWishlistView(customer.id);
    expect(back.items[0]!.inStock).toBe(true);
  });
});

describe("adminWishlistSummary", () => {
  it("counts wishlists, items and per-product saves, excluding deleted products", async () => {
    const jane = await mkCustomer("jane@example.com");
    const bob = await mkCustomer("bob@example.com");
    const popular = await mkProduct({ title: "Popular" });
    const niche = await mkProduct({ title: "Niche" });
    const gone = await mkProduct({ title: "Gone" });

    await addWishlistItem(jane.id, { productId: popular.id });
    await addWishlistItem(bob.id, { productId: popular.id });
    await addWishlistItem(jane.id, { productId: niche.id });
    await addWishlistItem(bob.id, { productId: gone.id });
    await db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, gone.id));

    const summary = await adminWishlistSummary({ page: 1, pageSize: 20 });
    expect(summary.totalWishlists).toBe(2);
    expect(summary.totalItems).toBe(3); // the deleted product's save is excluded
    expect(summary.products.total).toBe(2);
    expect(summary.products.items).toEqual([
      { productId: popular.id, title: "Popular", slug: popular.slug, count: 2 },
      { productId: niche.id, title: "Niche", slug: niche.slug, count: 1 },
    ]);
  });

  it("paginates the most-wishlisted list", async () => {
    const jane = await mkCustomer("jane@example.com");
    const a = await mkProduct({ title: "A" });
    const b = await mkProduct({ title: "B" });
    const c = await mkProduct({ title: "C" });
    for (const p of [a, b, c]) await addWishlistItem(jane.id, { productId: p.id });

    const page1 = await adminWishlistSummary({ page: 1, pageSize: 2 });
    expect(page1.products.items).toHaveLength(2);
    expect(page1.products.total).toBe(3);
    expect(page1.products.totalPages).toBe(2);

    const page2 = await adminWishlistSummary({ page: 2, pageSize: 2 });
    expect(page2.products.items).toHaveLength(1);
  });
});
