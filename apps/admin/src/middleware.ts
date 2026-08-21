import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session gate. Refreshes the Supabase session cookie and blocks
 * unauthenticated access to admin pages/APIs. Full RBAC (admin_users row +
 * role permissions) is checked in the node runtime — see lib/auth.ts —
 * because the edge runtime can't open a Postgres connection.
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/unauthorized",
  "/api/public",
  "/api/webhooks",
  "/api/health",
  "/auth",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Any early-return response must carry the refreshed auth cookies, or a
 *  rotated refresh token is dropped and Supabase's reuse detection can
 *  revoke the whole session. */
function withAuthCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Always call getUser() — it refreshes expired tokens via the cookie flow.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return withAuthCookies(
        NextResponse.json(
          { error: { code: "unauthorized", message: "Authentication required" } },
          { status: 401 },
        ),
        response,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return withAuthCookies(NextResponse.redirect(url), response);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return withAuthCookies(NextResponse.redirect(url), response);
  }

  return response;
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
