import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { cartItems, carts, productImages, products, productVariants } from "../db/schema";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { getSettings } from "../settings/service";
import { getAvailability } from "../inventory/service";
import type { AddCartItemInput, UpdateCartItemsInput } from "../validation/cart";

export const CART_TTL_DAYS = 14;
const MAX_LINE_QTY = 999;

export type CartItemView = {
  variantId: string;
  quantity: number;
  /** Snapshot price (minor units) captured when the item was added. */
  unitPrice: number;
  lineTotal: number;
  productId: string;
  productTitle: string;
  productSlug: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  /** Current catalog price — lets the storefront flag price changes. */
  currentPrice: number | null;
  inStock: boolean;
};

export type CartView = {
  id: string;
  token: string;
  status: (typeof carts.$inferSelect)["status"];
  currency: string;
  expiresAt: Date;
  items: CartItemView[];
  itemCount: number;
  subtotal: number;
};

function newCartToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createCart(): Promise<CartView> {
  const db = getDb();
  const settings = await getSettings();
  const [cart] = await db
    .insert(carts)
    .values({
      sessionToken: newCartToken(),
      currency: settings.currency,
      expiresAt: new Date(Date.now() + CART_TTL_DAYS * 86_400_000),
    })
    .returning();
  if (!cart) throw new Error("Cart insert failed");
  return buildCartView(cart, []);
}

type CartRow = typeof carts.$inferSelect;

/** Load + guard a cart for mutation: must exist, be active, and not be expired. */
async function getMutableCart(token: string): Promise<CartRow> {
  const db = getDb();
  const cart = await db.query.carts.findFirst({ where: eq(carts.sessionToken, token) });
  if (!cart) throw notFound("Cart not found");
  if (cart.status === "converted") throw conflict("This cart has already been checked out");
  if (cart.expiresAt < new Date() || cart.status === "expired" || cart.status === "abandoned") {
    if (cart.status === "active") {
      await db.update(carts).set({ status: "expired" }).where(eq(carts.id, cart.id));
    }
    throw new AppError("cart_expired", "This cart has expired — start a new one");
  }
  return cart;
}

export async function getCartByToken(token: string): Promise<CartView> {
  const db = getDb();
  const cart = await db.query.carts.findFirst({ where: eq(carts.sessionToken, token) });
  if (!cart) throw notFound("Cart not found");
  if (cart.status === "active" && cart.expiresAt < new Date()) {
    await db.update(carts).set({ status: "expired" }).where(eq(carts.id, cart.id));
    throw new AppError("cart_expired", "This cart has expired — start a new one");
  }

  const items = await loadItems(cart.id);
  return buildCartView(cart, items);
}

export async function addCartItem(token: string, input: AddCartItemInput): Promise<CartView> {
  const db = getDb();
  const cart = await getMutableCart(token);

  const variant = await db
    .select({
      id: productVariants.id,
      price: productVariants.price,
      productStatus: products.status,
    })
    .from(productVariants)
    .innerJoin(products, and(eq(products.id, productVariants.productId), isNull(products.deletedAt)))
    .where(and(eq(productVariants.id, input.variantId), isNull(productVariants.deletedAt)));
  const row = variant[0];
  if (!row || row.productStatus !== "active") throw notFound("Product not available");

  const existing = await db.query.cartItems.findFirst({
    where: and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, input.variantId)),
  });
  if (existing) {
    const quantity = Math.min(existing.quantity + input.quantity, MAX_LINE_QTY);
    await db
      .update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({
      cartId: cart.id,
      variantId: input.variantId,
      quantity: input.quantity,
      unitPrice: row.price,
    });
  }

  await touchCart(cart.id);
  return getCartByToken(token);
}

export async function updateCartItems(token: string, input: UpdateCartItemsInput): Promise<CartView> {
  const db = getDb();
  const cart = await getMutableCart(token);

  // Reject duplicate variant lines in one request — last-write ambiguity.
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.variantId)) throw badRequest("Duplicate variantId in items");
    seen.add(item.variantId);
  }

  for (const item of input.items) {
    if (item.quantity === 0) {
      await db
        .delete(cartItems)
        .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, item.variantId)));
      continue;
    }
    const existing = await db.query.cartItems.findFirst({
      where: and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, item.variantId)),
    });
    if (existing) {
      await db
        .update(cartItems)
        .set({ quantity: item.quantity, updatedAt: new Date() })
        .where(eq(cartItems.id, existing.id));
    } else {
      // New line via PATCH — snapshot the current price like addCartItem.
      const [variant] = await db
        .select({ price: productVariants.price, productStatus: products.status })
        .from(productVariants)
        .innerJoin(
          products,
          and(eq(products.id, productVariants.productId), isNull(products.deletedAt)),
        )
        .where(and(eq(productVariants.id, item.variantId), isNull(productVariants.deletedAt)));
      if (!variant || variant.productStatus !== "active") throw notFound("Product not available");
      await db.insert(cartItems).values({
        cartId: cart.id,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: variant.price,
      });
    }
  }

  await touchCart(cart.id);
  return getCartByToken(token);
}

async function touchCart(cartId: string): Promise<void> {
  const db = getDb();
  await db
    .update(carts)
    .set({ expiresAt: new Date(Date.now() + CART_TTL_DAYS * 86_400_000), updatedAt: new Date() })
    .where(eq(carts.id, cartId));
}

// ── Internals ────────────────────────────────────────────────

type LoadedItem = Awaited<ReturnType<typeof loadItems>>[number];

async function loadItems(cartId: string) {
  const db = getDb();
  const rows = await db
    .select({
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      unitPrice: cartItems.unitPrice,
      productId: products.id,
      productTitle: products.title,
      productSlug: products.slug,
      productDeletedAt: products.deletedAt,
      productStatus: products.status,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      currentPrice: productVariants.price,
      variantDeletedAt: productVariants.deletedAt,
      createdAt: cartItems.createdAt,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.createdAt));

  const imageByProduct = new Map<string, string>();
  if (rows.length > 0) {
    const images = await db
      .select({ productId: productImages.productId, url: productImages.url })
      .from(productImages)
      .where(inArray(productImages.productId, [...new Set(rows.map((r) => r.productId))]))
      .orderBy(asc(productImages.position));
    for (const img of images) {
      if (!imageByProduct.has(img.productId)) imageByProduct.set(img.productId, img.url);
    }
  }

  const availability = await getAvailability(rows.map((r) => r.variantId));

  return rows.map((r) => ({
    ...r,
    imageUrl: imageByProduct.get(r.productId) ?? null,
    inStock:
      r.productDeletedAt === null &&
      r.variantDeletedAt === null &&
      r.productStatus === "active" &&
      (availability.get(r.variantId)?.inStock ?? true),
  }));
}

function buildCartView(cart: CartRow, items: LoadedItem[]): CartView {
  const views: CartItemView[] = items.map((i) => ({
    variantId: i.variantId,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    lineTotal: i.unitPrice * i.quantity,
    productId: i.productId,
    productTitle: i.productTitle,
    productSlug: i.productSlug,
    variantTitle: i.variantTitle,
    sku: i.sku,
    imageUrl: i.imageUrl,
    currentPrice: i.currentPrice,
    inStock: i.inStock,
  }));
  return {
    id: cart.id,
    token: cart.sessionToken,
    status: cart.status,
    currency: cart.currency,
    expiresAt: cart.expiresAt,
    items: views,
    itemCount: views.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: views.reduce((sum, i) => sum + i.lineTotal, 0),
  };
}
