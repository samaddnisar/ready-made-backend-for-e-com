"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <TriangleAlert className="size-6 text-destructive" aria-hidden />
        </div>
        <p className="font-medium">Something went wrong</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The error has been logged. Try again, and if it keeps happening check the server logs
          {error.digest ? ` (digest ${error.digest})` : ""}.
        </p>
        <Button onClick={reset} variant="outline" className="mt-2">
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
