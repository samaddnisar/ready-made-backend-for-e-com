/**
 * Typed SDK for the public storefront API (§8). A custom storefront imports
 * this instead of hand-rolling fetch calls:
 *
 *   const api = createApiClient({ baseUrl: "https://admin.example.com" });
 *   const { features } = await api.settings.get();
 *
 * Endpoints grow phase by phase alongside /api/public/*.
 */

import type { ApiFailure, ApiResponse, ErrorCode, FeatureKey } from "@repo/core";

export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ApiClientOptions = {
  /** Origin of the deployed admin app, e.g. "https://admin.example.com". */
  baseUrl: string;
  /** Supabase access token for authed customer endpoints. */
  getAuthToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
};

export type PublicSettings = {
  storeName: string;
  currency: string;
  logoUrl: string | null;
  features: FeatureKey[];
};

// ── Catalog payloads (mirror /api/public/* responses; money = integer cents) ──

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PublicProductListItem = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  compareAtPrice: number | null;
  /** List responses carry at most the primary image. */
  images: { url: string; alt: string | null }[];
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
};

export type PublicProduct = PublicProductListItem & {
  variants: {
    id: string;
    title: string | null;
    sku: string | null;
    price: number;
    compareAtPrice: number | null;
    optionValues: Record<string, string>;
    /** Purchasable right now (untracked, backorderable, or stock available). */
    inStock: boolean;
  }[];
  categories: { name: string; slug: string }[];
};

export type PublicRelatedProduct = {
  id: string;
  title: string;
  slug: string;
  minPrice: number | null;
  thumbnailUrl: string | null;
};

export type PublicCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  position: number;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  productCount: number;
};

export type PublicCollection = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
};

export type PublicCollectionPage = {
  collection: PublicCollection;
  products: Paginated<PublicProductListItem>;
};

// ── Cart & checkout payloads (Phase 4; mirror core's cart/checkout services) ──

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
  /** Opaque session token — store client-side and pass to every cart call. */
  token: string;
  status: "active" | "converted" | "abandoned" | "expired";
  currency: string;
  /** ISO timestamp (Dates serialize to strings over JSON). */
  expiresAt: string;
  items: CartItemView[];
  itemCount: number;
  subtotal: number;
  /** Codes currently applied to the cart. */
  discountCodes: string[];
  /** Projected goods discount for the applied codes (minor units). */
  discountTotal: number;
  /** One of the applied codes grants free shipping. */
  freeShipping: boolean;
  /** Set when stored codes stopped being valid (expired, limit reached…). */
  discountError: string | null;
};

export type ResolvedShippingRate = {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  type: "flat" | "weight" | "price";
  /** Minor units. */
  price: number;
};

export type CheckoutAddress = {
  firstName?: string;
  lastName?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  phone?: string;
};

export type CheckoutRequest = {
  cartToken: string;
  email: string;
  shippingAddress: CheckoutAddress;
  /** Defaults to the shipping address when omitted. */
  billingAddress?: CheckoutAddress;
  /**
   * Required whenever the store has shipping rates for the destination —
   * fetch them with api.shipping.rates(); checkout rejects otherwise.
   */
  shippingRateId?: string;
  /** Extra code applied at checkout (cart-applied codes are included automatically). */
  discountCode?: string;
};

export type CheckoutResult = {
  orderId: string;
  orderNumber: string;
  /** Hand to Stripe.js (Elements / confirmPayment) to collect payment. */
  clientSecret: string;
  /** Minor units — what the PaymentIntent will charge. */
  amount: number;
  currency: string;
};

// ── Customer account payloads (Phase 6; authed via getAuthToken → Bearer) ──

export type CustomerOrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "completed"
  | "partially_refunded"
  | "refunded"
  | "cancelled"
  | "payment_failed";

export type CustomerAddress = {
  id: string;
  customerId: string;
  type: "shipping" | "billing";
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
  phone: string | null;
  isDefault: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
};

export type CustomerProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  marketingOptIn: boolean;
  /** ISO timestamp. */
  createdAt: string;
  addresses: CustomerAddress[];
};

/** Self-service profile edits — internal admin notes are not editable here. */
export type CustomerProfileUpdate = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  marketingOptIn?: boolean;
};

export type CustomerAddressInput = {
  /** Defaults to "shipping" when omitted. */
  type?: "shipping" | "billing";
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  /** ISO 3166-1 alpha-2 (case-insensitive; stored uppercase). */
  country: string;
  phone?: string | null;
  /** Demotes the previous default of the same type. */
  isDefault?: boolean;
};

export type CustomerAddressUpdate = Partial<CustomerAddressInput>;

export type CustomerOrderSummary = {
  id: string;
  orderNumber: string;
  status: CustomerOrderStatus;
  /** Minor units. */
  grandTotal: number;
  currency: string;
  /** ISO timestamp. */
  createdAt: string;
};

/** Purchase-time snapshot line — never live catalog data. */
export type CustomerOrderItem = {
  id: string;
  orderId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  /** Minor units, snapshot at purchase. */
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
};

/** Mirror of getCustomerOrder: order columns minus internal notes, plus items. */
export type CustomerOrderDetail = {
  id: string;
  orderNumber: string;
  customerId: string | null;
  email: string;
  status: CustomerOrderStatus;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  /** Minor units. */
  grandTotal: number;
  currency: string;
  /** Address snapshots captured at checkout. */
  shippingAddress: CheckoutAddress | null;
  billingAddress: CheckoutAddress | null;
  shippingRateName: string | null;
  discountCode: string | null;
  cartId: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  items: CustomerOrderItem[];
};

export type PublicProductsQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  category?: string;
  collection?: string;
  sort?: "newest" | "price_asc" | "price_desc" | "title";
};

/** Collection pages already scope to the collection's slug. */
export type PublicCollectionProductsQuery = Omit<PublicProductsQuery, "collection">;

/** Serialize query params, skipping undefined values. */
function toQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function request<T>(
  opts: ApiClientOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const doFetch = opts.fetch ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const token = await opts.getAuthToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await doFetch(`${opts.baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json: ApiResponse<T> | undefined;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON response (proxy error page etc.) — fall through.
  }

  if (!res.ok || !json || "error" in json) {
    const err = (json as ApiFailure | undefined)?.error;
    throw new ApiClientError(
      err?.code ?? "internal_error",
      err?.message ?? `Request failed with status ${res.status}`,
      res.status,
      err?.details,
    );
  }
  return json.data;
}

export function createApiClient(opts: ApiClientOptions) {
  return {
    settings: {
      /** Enabled features + store info — drive storefront rendering off this. */
      get: () => request<PublicSettings>(opts, "GET", "/api/public/settings"),
    },
    health: {
      get: () => request<{ ok: boolean }>(opts, "GET", "/api/health"),
    },
    products: {
      /** Paginated active products; filter by q/category/collection, sort. */
      list: (query?: PublicProductsQuery) =>
        request<Paginated<PublicProductListItem>>(
          opts,
          "GET",
          `/api/public/products${toQueryString(query)}`,
        ),
      /** Full product detail by slug (404 unless active). */
      get: (slug: string) =>
        request<PublicProduct>(opts, "GET", `/api/public/products/${encodeURIComponent(slug)}`),
      /** Related products (404 when the related_products feature is off). */
      related: (slug: string) =>
        request<{ items: PublicRelatedProduct[] }>(
          opts,
          "GET",
          `/api/public/products/${encodeURIComponent(slug)}/related`,
        ),
    },
    categories: {
      /** Flat list — assemble the tree via parentId. */
      list: () => request<PublicCategory[]>(opts, "GET", "/api/public/categories"),
    },
    collections: {
      /** Collection metadata + a paginated page of its products. */
      get: (slug: string, query?: PublicCollectionProductsQuery) =>
        request<PublicCollectionPage>(
          opts,
          "GET",
          `/api/public/collections/${encodeURIComponent(slug)}${toQueryString(query)}`,
        ),
    },
    shipping: {
      /** Rates for a destination given the cart's contents — pick one for checkout. */
      rates: (cartToken: string, country: string) =>
        request<{ rates: ResolvedShippingRate[] }>(
          opts,
          "GET",
          `/api/public/shipping-rates${toQueryString({ cartToken, country })}`,
        ),
    },
    cart: {
      /** Create an anonymous cart; persist the returned token client-side. */
      create: () => request<CartView>(opts, "POST", "/api/public/cart"),
      /** Current cart contents (404 for unknown tokens, cart_expired when stale). */
      get: (token: string) =>
        request<CartView>(opts, "GET", `/api/public/cart/${encodeURIComponent(token)}`),
      /** Add a variant (merges into an existing line); returns the updated cart. */
      addItem: (token: string, input: { variantId: string; quantity: number }) =>
        request<CartView>(
          opts,
          "POST",
          `/api/public/cart/${encodeURIComponent(token)}/items`,
          input,
        ),
      /** Apply a discount code; rejects with the server's reason when invalid. */
      applyDiscount: (token: string, code: string) =>
        request<CartView>(
          opts,
          "POST",
          `/api/public/cart/${encodeURIComponent(token)}/discount`,
          { code },
        ),
      /** Remove one code, or every code when omitted. */
      removeDiscount: (token: string, code?: string) =>
        request<CartView>(
          opts,
          "DELETE",
          `/api/public/cart/${encodeURIComponent(token)}/discount${code ? `?code=${encodeURIComponent(code)}` : ""}`,
        ),
      /** Set line quantities (0 removes a line); returns the updated cart. */
      updateItems: (token: string, input: { items: { variantId: string; quantity: number }[] }) =>
        request<CartView>(
          opts,
          "PATCH",
          `/api/public/cart/${encodeURIComponent(token)}/items`,
          input,
        ),
    },
    checkout: {
      /**
       * Start checkout: reserves stock, creates the pending order, and returns
       * the Stripe PaymentIntent client secret to confirm payment with.
       */
      create: (input: CheckoutRequest) =>
        request<CheckoutResult>(opts, "POST", "/api/public/checkout", input),
    },
    /**
     * Signed-in customer account (Phase 6). Every call requires
     * `getAuthToken` to return a valid Supabase access token — requests
     * without one fail with 401 unauthorized.
     */
    customer: {
      /** Profile + address book of the signed-in customer. */
      me: () => request<CustomerProfile>(opts, "GET", "/api/public/customer/me"),
      /** Self-service profile edits; returns the updated profile. */
      updateMe: (input: CustomerProfileUpdate) =>
        request<CustomerProfile>(opts, "PATCH", "/api/public/customer/me", input),
      /** Paginated order history, newest first. */
      orders: (query?: { page?: number; pageSize?: number }) =>
        request<Paginated<CustomerOrderSummary>>(
          opts,
          "GET",
          `/api/public/customer/orders${toQueryString(query)}`,
        ),
      /** Order detail — 404 unless the order belongs to this customer. */
      order: (id: string) =>
        request<CustomerOrderDetail>(
          opts,
          "GET",
          `/api/public/customer/orders/${encodeURIComponent(id)}`,
        ),
      addresses: {
        list: () => request<CustomerAddress[]>(opts, "GET", "/api/public/customer/addresses"),
        /** `isDefault: true` demotes the previous default of the same type. */
        create: (input: CustomerAddressInput) =>
          request<CustomerAddress>(opts, "POST", "/api/public/customer/addresses", input),
        update: (id: string, input: CustomerAddressUpdate) =>
          request<CustomerAddress>(
            opts,
            "PATCH",
            `/api/public/customer/addresses/${encodeURIComponent(id)}`,
            input,
          ),
        remove: (id: string) =>
          request<{ deleted: boolean }>(
            opts,
            "DELETE",
            `/api/public/customer/addresses/${encodeURIComponent(id)}`,
          ),
      },
      /** Loyalty balance + ledger (404 when the loyalty feature is off). Authed. */
      loyalty: (query?: { page?: number; pageSize?: number }) =>
        request<LoyaltyAccountView>(
          opts,
          "GET",
          `/api/public/customer/loyalty${toQueryString(query)}`,
        ),
    },
    // ── Feature-scoped namespaces (404 when the feature is disabled — check
    //    settings.get().features before rendering their UI) ──
    reviews: {
      /** Submit a review (authed; one per customer+product). */
      submit: (input: { productId: string; rating: number; title?: string; body?: string }) =>
        request<SubmittedReview>(opts, "POST", "/api/public/reviews", input),
      /** Approved reviews + rating summary for a product. */
      list: (productSlug: string, query?: { page?: number; pageSize?: number }) =>
        request<PublicReviewsResult>(
          opts,
          "GET",
          `/api/public/products/${encodeURIComponent(productSlug)}/reviews${toQueryString(query)}`,
        ),
    },
    wishlist: {
      /** The signed-in customer's wishlist. Authed. */
      get: () => request<WishlistView>(opts, "GET", "/api/public/customer/wishlist"),
      add: (input: { productId: string; variantId?: string }) =>
        request<WishlistView>(opts, "POST", "/api/public/customer/wishlist", input),
      remove: (productId: string) =>
        request<{ removed: boolean }>(
          opts,
          "DELETE",
          `/api/public/customer/wishlist/${encodeURIComponent(productId)}`,
        ),
    },
    giftCards: {
      /** Balance check — invalid/unknown codes uniformly return { valid: false }. */
      validate: (code: string) =>
        request<GiftCardValidationResult>(opts, "POST", "/api/public/gift-cards/validate", { code }),
    },
    newsletter: {
      subscribe: (email: string, source?: string) =>
        request<{ subscribed: boolean }>(opts, "POST", "/api/public/newsletter", {
          email,
          ...(source ? { source } : {}),
        }),
      unsubscribe: (email: string) =>
        request<{ subscribed: boolean }>(opts, "DELETE", "/api/public/newsletter", { email }),
    },
    blog: {
      list: (query?: { page?: number; pageSize?: number }) =>
        request<Paginated<PublicBlogPostListItem>>(
          opts,
          "GET",
          `/api/public/blog${toQueryString(query)}`,
        ),
      get: (slug: string) =>
        request<PublicBlogPost>(opts, "GET", `/api/public/blog/${encodeURIComponent(slug)}`),
    },
    pages: {
      get: (slug: string) =>
        request<PublicCmsPage>(opts, "GET", `/api/public/pages/${encodeURIComponent(slug)}`),
    },
  };
}

// ── Feature-scoped payloads (Phase 8 modules; dates are ISO strings) ──

export type SubmittedReview = {
  id: string;
  productId: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type PublicReviewItem = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  /** Anonymized, e.g. "Jane D." */
  customerName: string;
  verifiedPurchase: boolean;
  createdAt: string;
};

export type PublicReviewsResult = Paginated<PublicReviewItem> & {
  summary: { averageRating: number; reviewCount: number };
};

export type WishlistItemView = {
  id: string;
  productId: string;
  variantId: string | null;
  title: string;
  slug: string;
  minPrice: number | null;
  thumbnailUrl: string | null;
  inStock: boolean;
  addedAt: string;
};

export type WishlistView = { id: string; name: string; items: WishlistItemView[] };

export type GiftCardValidationResult =
  | { valid: false }
  | { valid: true; balance: number; currency: string; status: "active" };

export type LoyaltyLedgerItem = {
  id: string;
  delta: number;
  reason: string;
  orderId: string | null;
  createdAt: string;
};

export type LoyaltyAccountView = { balance: number; ledger: Paginated<LoyaltyLedgerItem> };

export type PublicBlogPostListItem = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: string[];
  publishedAt: string | null;
};

export type PublicBlogPost = PublicBlogPostListItem & {
  content: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  updatedAt: string;
};

export type PublicCmsPage = {
  id: string;
  title: string;
  slug: string;
  content: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  updatedAt: string;
};

export type ApiClient = ReturnType<typeof createApiClient>;
