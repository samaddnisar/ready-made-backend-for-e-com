import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import {
  AppError,
  badRequest,
  isFeatureEnabled,
  notFound,
  toFailure,
  validationError,
  type Action,
  type ApiSuccess,
  type FeatureKey,
  type Resource,
} from "@repo/core";
import { requirePermission, type AdminContext } from "./auth";

/** Success envelope: { data } (§8). */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, init);
}

export function fail(err: unknown): NextResponse {
  const { body, status } = toFailure(err);
  if (status >= 500) console.error("[api]", err);
  return NextResponse.json(body, { status });
}

/**
 * CSRF guard for state-changing requests (§9): browsers send Sec-Fetch-Site
 * on all fetches; require same-origin (or a non-browser client with neither
 * header, e.g. server-to-server with a bearer token).
 */
export function assertSameOrigin(req: NextRequest): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    if (secFetchSite === "same-origin" || secFetchSite === "none") return;
    throw new AppError("forbidden", "Cross-origin request rejected");
  }

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("forbidden", "Cross-origin request rejected");
    }
    if (originHost !== host) throw new AppError("forbidden", "Cross-origin request rejected");
  }
}

type RouteContext = { params: Promise<Record<string, string>> };

export type AdminHandler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>>; admin: AdminContext },
) => Promise<NextResponse>;

/**
 * Wrapper for /api/admin/* routes: CSRF check, auth, server-side RBAC,
 * and AppError → envelope mapping. Every admin route goes through this.
 */
export function withAdminApi(
  opts: { resource: Resource; action: Action },
  handler: AdminHandler,
): (req: NextRequest, ctx: RouteContext) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      const admin = await requirePermission(opts.resource, opts.action);
      return await handler(req, { params: ctx.params, admin });
    } catch (err) {
      return fail(err);
    }
  };
}

export type PublicHandler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;

/** Wrapper for /api/public/* routes: error envelope only (no auth). */
export function withPublicApi(handler: PublicHandler): PublicHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return fail(err);
    }
  };
}

/**
 * Feature-flag gate (§4): a disabled feature's endpoints return 404.
 * Compose outside the auth wrapper: withFeature("reviews", withAdminApi(…)).
 */
export function withFeature<H extends (req: NextRequest, ctx: any) => Promise<NextResponse>>(
  key: FeatureKey,
  handler: H,
): H {
  return (async (req: NextRequest, ctx: unknown) => {
    try {
      if (!(await isFeatureEnabled(key))) throw notFound();
    } catch (err) {
      return fail(err);
    }
    return handler(req, ctx as never);
  }) as H;
}

/** Parse + validate a JSON body with a shared Zod schema. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw validationError(
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

/** Parse + validate query params (works with z.coerce schemas). */
export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    throw validationError(
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
