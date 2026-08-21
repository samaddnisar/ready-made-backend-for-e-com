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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
