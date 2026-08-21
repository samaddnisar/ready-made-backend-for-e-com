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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
