import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — full storage/auth admin access, server only.
 * NEVER import from a client component; "server-only" enforces it.
 */
let _client: SupabaseClient | undefined;

export function createSupabaseAdminClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

/** Storage bucket for the media library. Create it once per Supabase project. */
export const MEDIA_BUCKET = "media";
