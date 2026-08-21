"use client";

/**
 * Client-side fetch wrapper for the admin API. Unwraps the shared envelope
 * ({ data } | { error }) and throws ApiError with the server's message so
 * callers can `toast.error(err.message)`.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(path, {
    method: options?.method ?? "GET",
    headers: options?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("internal_error", `Request failed (${res.status})`, res.status);
  }

  const failure = json as { error?: { code: string; message: string; details?: unknown } };
  if (!res.ok || failure.error) {
    throw new ApiError(
      failure.error?.code ?? "internal_error",
      failure.error?.message ?? `Request failed (${res.status})`,
      res.status,
      failure.error?.details,
    );
  }
  return (json as { data: T }).data;
}

/** Multipart upload (no JSON content-type — the browser sets the boundary). */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: formData });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("internal_error", `Upload failed (${res.status})`, res.status);
  }
  const failure = json as { error?: { code: string; message: string } };
  if (!res.ok || failure.error) {
    throw new ApiError(
      failure.error?.code ?? "internal_error",
      failure.error?.message ?? `Upload failed (${res.status})`,
      res.status,
    );
  }
  return (json as { data: T }).data;
}
