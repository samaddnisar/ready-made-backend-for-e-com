import { Hammer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Empty-state stub for modules whose build phase hasn't landed yet. */
export function PagePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: number;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Hammer className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <p className="font-medium">Coming in build phase {phase}</p>
          <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
