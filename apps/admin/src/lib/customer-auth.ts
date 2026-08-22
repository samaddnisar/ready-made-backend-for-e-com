import "server-only";

import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOrCreateCustomerByAuth, unauthorized, type Customer } from "@repo/core";

/**
 * Customer authentication for /api/public/customer/* (§8): the storefront
 * sends the Supabase access token as `Authorization: Bearer <jwt>`
 * (@repo/api-client's getAuthToken option does this). Token verification
 * goes through Supabase; the customers row is created/linked on first use.
 */
export async function requireCustomer(req: NextRequest): Promise<Customer> {
  const customer = await optionalCustomer(req);
  if (!customer) throw unauthorized("Sign in to access your account");
  return customer;
}

/** Same, but resolves to null instead of throwing (e.g. guest checkout). */
export async function optionalCustomer(req: NextRequest): Promise<Customer | null> {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user?.email) return null;

  return getOrCreateCustomerByAuth(user.id, user.email);
}
