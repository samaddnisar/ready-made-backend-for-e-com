import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  discountCategories,
  discountProducts,
  discountRedemptions,
  discounts,
  orders,
  productCategories,
} from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { paginate, type Paginated } from "../validation/common";
import type {
  CreateDiscountInput,
  ListDiscountsQuery,
  UpdateDiscountInput,
} from "../validation/promotions";

export type Discount = typeof discounts.$inferSelect;

export const MAX_STACKED_CODES = 3;

// ── Admin CRUD ───────────────────────────────────────────────

export type DiscountListItem = Discount & { redemptionCount: number };

const redemptionCountSql = sql<number>`(select count(*)::int from discount_redemptions dr where dr.discount_id = discounts.id)`;

export async function listDiscounts(query: ListDiscountsQuery): Promise<Paginated<DiscountListItem>> {
  const db = getDb();
  const filters: SQL[] = [];
  if (query.q) filters.push(ilike(discounts.code, `%${query.q}%`));
  if (query.active !== undefined) filters.push(eq(discounts.isActive, query.active));
  const where = filters.length ? and(...filters) : undefined;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(discounts)
    .where(where);
  const rows = await db
    .select({
      id: discounts.id,
      code: discounts.code,
      type: discounts.type,
      value: discounts.value,
      minSpend: discounts.minSpend,
      usageLimit: discounts.usageLimit,
      perCustomerLimit: discounts.perCustomerLimit,
      startsAt: discounts.startsAt,
      endsAt: discounts.endsAt,
      appliesTo: discounts.appliesTo,
      stackable: discounts.stackable,
      isActive: discounts.isActive,
      createdAt: discounts.createdAt,
      updatedAt: discounts.updatedAt,
      redemptionCount: redemptionCountSql,
    })
    .from(discounts)
    .where(where)
    .orderBy(desc(discounts.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

export type DiscountDetail = DiscountListItem & { productIds: string[]; categoryIds: string[] };

export async function getDiscountDetail(id: string): Promise<DiscountDetail> {
  const db = getDb();
  const discount = await db.query.discounts.findFirst({ where: eq(discounts.id, id) });
  if (!discount) throw notFound("Discount not found");

  const [products, categories, [countRow]] = await Promise.all([
    db.select({ id: discountProducts.productId }).from(discountProducts).where(eq(discountProducts.discountId, id)),
    db.select({ id: discountCategories.categoryId }).from(discountCategories).where(eq(discountCategories.discountId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(discountRedemptions).where(eq(discountRedemptions.discountId, id)),
  ]);

  return {
    ...discount,
    redemptionCount: countRow?.n ?? 0,
    productIds: products.map((p) => p.id),
    categoryIds: categories.map((c) => c.id),
  };
}

async function replaceTargets(
  discountId: string,
  productIds?: string[],
  categoryIds?: string[],
): Promise<void> {
  const db = getDb();
  if (productIds) {
    await db.delete(discountProducts).where(eq(discountProducts.discountId, discountId));
    if (productIds.length > 0) {
      await db
        .insert(discountProducts)
        .values(productIds.map((productId) => ({ discountId, productId })))
        .onConflictDoNothing();
    }
  }
  if (categoryIds) {
    await db.delete(discountCategories).where(eq(discountCategories.discountId, discountId));
    if (categoryIds.length > 0) {
      await db
        .insert(discountCategories)
        .values(categoryIds.map((categoryId) => ({ discountId, categoryId })))
        .onConflictDoNothing();
    }
  }
}

export async function createDiscount(input: CreateDiscountInput): Promise<DiscountDetail> {
  const db = getDb();
  const { productIds, categoryIds, startsAt, endsAt, ...rest } = input;
  const [row] = await db
    .insert(discounts)
    .values({
      ...rest,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
    })
    .returning();
  if (!row) throw new Error("Insert failed");
  await replaceTargets(row.id, productIds, categoryIds);
  return getDiscountDetail(row.id);
}

export async function updateDiscount(id: string, input: UpdateDiscountInput): Promise<DiscountDetail> {
  const db = getDb();
  const existing = await db.query.discounts.findFirst({ where: eq(discounts.id, id) });
  if (!existing) throw notFound("Discount not found");

  // Cross-field rules must hold on the MERGED state — the create-schema
  // superRefine can't see the stored half of a partial update.
  const merged = {
    type: input.type ?? existing.type,
    value: input.value ?? existing.value,
    appliesTo: input.appliesTo ?? existing.appliesTo,
    startsAt: input.startsAt !== undefined ? input.startsAt && new Date(input.startsAt) : existing.startsAt,
    endsAt: input.endsAt !== undefined ? input.endsAt && new Date(input.endsAt) : existing.endsAt,
  };
  if (merged.type === "percent" && merged.value > 100) {
    throw badRequest("Percent can't exceed 100");
  }
  if (merged.type !== "free_shipping" && merged.value <= 0) {
    throw badRequest("Value must be positive");
  }
  if (merged.startsAt && merged.endsAt && merged.startsAt >= merged.endsAt) {
    throw badRequest("End must be after start");
  }
  if (merged.appliesTo === "products" || merged.appliesTo === "categories") {
    const incoming = merged.appliesTo === "products" ? input.productIds : input.categoryIds;
    if (incoming !== undefined) {
      if (incoming.length === 0) throw badRequest(`Select at least one ${merged.appliesTo === "products" ? "product" : "category"}`);
    } else {
      const table = merged.appliesTo === "products" ? discountProducts : discountCategories;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.discountId, id));
      if ((row?.n ?? 0) === 0) {
        throw badRequest(
          `This discount is scoped to ${merged.appliesTo} but has no targets — select at least one`,
        );
      }
    }
  }

  const { productIds, categoryIds, startsAt, endsAt, ...rest } = input;
  const set: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  );
  if (startsAt !== undefined) set.startsAt = startsAt ? new Date(startsAt) : null;
  if (endsAt !== undefined) set.endsAt = endsAt ? new Date(endsAt) : null;
  set.updatedAt = new Date();

  await db.update(discounts).set(set).where(eq(discounts.id, id));
  await replaceTargets(id, productIds, categoryIds);
  return getDiscountDetail(id);
}

export async function deleteDiscount(id: string): Promise<void> {
  const db = getDb();
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(discountRedemptions)
    .where(eq(discountRedemptions.discountId, id));
  if ((countRow?.n ?? 0) > 0) {
    throw conflict("This discount has been used — deactivate it instead to keep usage history");
  }
  const [row] = await db.delete(discounts).where(eq(discounts.id, id)).returning({ id: discounts.id });
  if (!row) throw notFound("Discount not found");
}

// ── Application math (money path — §9) ───────────────────────

export type CartLineForDiscount = {
  productId: string;
  quantity: number;
  unitPrice: number;
};

export type DiscountApplication = {
  code: string;
  discountId: string;
  type: Discount["type"];
  /** Minor units off the goods subtotal (0 for free_shipping). */
  amount: number;
  freeShipping: boolean;
};

export type DiscountResolution = {
  applications: DiscountApplication[];
  discountTotal: number;
  freeShipping: boolean;
};

/**
 * Validate + price a set of codes against cart lines. Stacking rules (§5):
 * multiple codes may combine only if EVERY one of them is stackable.
 * Percent/fixed amounts are computed on each code's eligible base
 * (independently, not sequentially) and the sum is capped at the subtotal.
 * Guests (no customerId) skip per-customer limits — enforced for accounts.
 */
export async function resolveDiscounts(
  codes: string[],
  lines: CartLineForDiscount[],
  customerId?: string | null,
  now = new Date(),
): Promise<DiscountResolution> {
  const unique = [...new Set(codes.map((c) => c.toUpperCase()))];
  if (unique.length === 0) return { applications: [], discountTotal: 0, freeShipping: false };
  if (unique.length > MAX_STACKED_CODES) {
    throw badRequest(`At most ${MAX_STACKED_CODES} codes can be applied`);
  }

  const db = getDb();
  const rows = await db.select().from(discounts).where(inArray(discounts.code, unique));
  const byCode = new Map(rows.map((r) => [r.code, r]));

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const applications: DiscountApplication[] = [];

  for (const code of unique) {
    const discount = byCode.get(code);
    if (!discount || !discount.isActive) throw badRequest(`Code ${code} is not valid`);
    if (discount.startsAt && discount.startsAt > now) {
      throw badRequest(`Code ${code} is not active yet`);
    }
    if (discount.endsAt && discount.endsAt < now) throw badRequest(`Code ${code} has expired`);
    if (unique.length > 1 && !discount.stackable) {
      throw conflict(`Code ${code} can't be combined with other codes`);
    }
    if (discount.minSpend !== null && subtotal < discount.minSpend) {
      throw badRequest(`Code ${code} requires a minimum spend of ${discount.minSpend}`);
    }

    if (discount.usageLimit !== null) {
      const [used] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(discountRedemptions)
        .where(eq(discountRedemptions.discountId, discount.id));
      if ((used?.n ?? 0) >= discount.usageLimit) {
        throw badRequest(`Code ${code} has reached its usage limit`);
      }
    }
    if (discount.perCustomerLimit !== null && customerId) {
      const [used] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(discountRedemptions)
        .where(
          and(
            eq(discountRedemptions.discountId, discount.id),
            eq(discountRedemptions.customerId, customerId),
          ),
        );
      if ((used?.n ?? 0) >= discount.perCustomerLimit) {
        throw badRequest(`Code ${code} has already been used the maximum number of times`);
      }
    }

    const eligible = await eligibleSubtotal(discount, lines, subtotal);
    if (discount.type !== "free_shipping" && eligible <= 0) {
      throw badRequest(`Code ${code} doesn't apply to anything in this cart`);
    }

    const amount =
      discount.type === "percent"
        ? Math.floor((eligible * discount.value) / 100)
        : discount.type === "fixed"
          ? Math.min(discount.value, eligible)
          : 0;

    applications.push({
      code,
      discountId: discount.id,
      type: discount.type,
      amount,
      freeShipping: discount.type === "free_shipping",
    });
  }

  const raw = applications.reduce((sum, a) => sum + a.amount, 0);
  return {
    applications,
    discountTotal: Math.min(raw, subtotal),
    freeShipping: applications.some((a) => a.freeShipping),
  };
}

async function eligibleSubtotal(
  discount: Discount,
  lines: CartLineForDiscount[],
  subtotal: number,
): Promise<number> {
  if (discount.appliesTo === "all") return subtotal;
  const db = getDb();

  if (discount.appliesTo === "products") {
    const targets = await db
      .select({ id: discountProducts.productId })
      .from(discountProducts)
      .where(eq(discountProducts.discountId, discount.id));
    const targetSet = new Set(targets.map((t) => t.id));
    return lines
      .filter((l) => targetSet.has(l.productId))
      .reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  }

  // categories: lines whose product belongs to any targeted category.
  const targets = await db
    .select({ id: discountCategories.categoryId })
    .from(discountCategories)
    .where(eq(discountCategories.discountId, discount.id));
  if (targets.length === 0) return 0;
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const links = await db
    .select({ productId: productCategories.productId })
    .from(productCategories)
    .where(
      and(
        inArray(productCategories.productId, productIds),
        inArray(
          productCategories.categoryId,
          targets.map((t) => t.id),
        ),
      ),
    );
  const eligibleProducts = new Set(links.map((l) => l.productId));
  return lines
    .filter((l) => eligibleProducts.has(l.productId))
    .reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
}

/**
 * Record redemptions for a paid order (idempotent — unique per
 * discount+order). Called from the payment webhook.
 */
export async function recordDiscountRedemptions(orderId: string): Promise<void> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order?.discountCode) return;

  const codes = order.discountCode.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return;

  const rows = await db.select().from(discounts).where(inArray(discounts.code, codes));
  for (const discount of rows) {
    await db
      .insert(discountRedemptions)
      .values({ discountId: discount.id, orderId, customerId: order.customerId })
      .onConflictDoNothing();
  }
}
