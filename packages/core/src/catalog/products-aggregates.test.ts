/**
 * Regression: correlated subqueries in single-table selects must reference
 * the outer table with an explicit qualified name — drizzle renders
 * ${table.column} UNQUALIFIED in select projections, which silently made
 * these aggregates self-referential (minPrice null, counts 0).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import {
  categories,
  inventory,
  productCategories,
  productImages,
  products,
  productVariants,
} from "../db/schema";
import { listProducts, listPublicProducts, getRelatedProducts } from "./products";
import { listCategories } from "./taxonomy";

let db: Db;
let productId: string;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  for (const t of [inventory, productImages, productCategories, productVariants, products, categories]) {
    await db.delete(t);
  }
  const [p] = await db
    .insert(products)
    .values({ title: "Shirt", slug: "shirt", status: "active" })
    .returning();
  productId = p!.id;
  const [v1] = await db
    .insert(productVariants)
    .values({ productId, price: 1000, position: 0 })
    .returning();
  await db.insert(productVariants).values({ productId, price: 3000, position: 1 });
  await db.insert(inventory).values({ variantId: v1!.id, quantity: 7, trackInventory: true });
  await db.insert(productImages).values({ productId, url: "https://img/1.jpg", position: 0 });
});

describe("listProducts aggregates", () => {
  it("computes price range, variant count, stock and thumbnail correctly", async () => {
    const result = await listProducts({
      page: 1,
      pageSize: 10,
      sort: "updatedAt",
      order: "desc",
    });
    const row = result.items[0]!;
    expect(row.minPrice).toBe(1000);
    expect(row.maxPrice).toBe(3000);
    expect(row.variantCount).toBe(2);
    expect(row.totalStock).toBe(7);
    expect(row.thumbnailUrl).toBe("https://img/1.jpg");
  });

  it("category filter matches via the join table", async () => {
    const [cat] = await db.insert(categories).values({ name: "Tops", slug: "tops" }).returning();
    await db.insert(productCategories).values({ productId, categoryId: cat!.id });

    const filtered = await listProducts({
      page: 1,
      pageSize: 10,
      sort: "updatedAt",
      order: "desc",
      categoryId: cat!.id,
    });
    expect(filtered.total).toBe(1);

    const counts = await listCategories();
    expect(counts.find((c) => c.id === cat!.id)!.productCount).toBe(1);
  });

  it("public listing carries the same aggregates", async () => {
    const result = await listPublicProducts({ page: 1, pageSize: 10, sort: "newest" });
    expect(result.items[0]!.minPrice).toBe(1000);
    expect(result.items[0]!.images[0]!.url).toBe("https://img/1.jpg");
  });

  it("related-products fallback excludes self and returns real prices", async () => {
    const [cat] = await db.insert(categories).values({ name: "Tops", slug: "tops" }).returning();
    const [other] = await db
      .insert(products)
      .values({ title: "Other", slug: "other", status: "active" })
      .returning();
    await db.insert(productVariants).values({ productId: other!.id, price: 500 });
    await db.insert(productCategories).values([
      { productId, categoryId: cat!.id },
      { productId: other!.id, categoryId: cat!.id },
    ]);

    const related = await getRelatedProducts(productId, 4);
    expect(related.map((r) => r.slug)).toEqual(["other"]);
    expect(related[0]!.minPrice).toBe(500);
  });
});
