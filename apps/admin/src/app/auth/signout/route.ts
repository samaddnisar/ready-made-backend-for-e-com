import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, fail } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  } catch (err) {
    return fail(err);
  }
}
