import type { Metadata } from "next";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Not authorized" };

/**
 * Landing spot for a valid Supabase session with no admin_users row
 * (e.g. a customer account, or a revoked admin). Public in the middleware
 * so it never joins the /login ↔ /dashboard redirect dance.
 */
export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-destructive/10">
            <ShieldX className="size-5 text-destructive" aria-hidden />
          </div>
          <CardTitle>Not an admin account</CardTitle>
          <CardDescription>
            You&apos;re signed in, but this account doesn&apos;t have access to the admin panel.
            Ask an administrator to invite you, or sign in with a different account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
