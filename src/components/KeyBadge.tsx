import { Badge } from "@/components/ui/badge";

export const SPARE_KEY_SWATCH: Record<string, string> = {
  missing: "bg-destructive",
  available: "bg-success",
  taken: "bg-primary",
  taken_for_cleaning: "bg-accent",
  damaged: "bg-warning",
  with_employee: "bg-info",
  unknown: "bg-muted-foreground",
};

export function KeyBadge({ status }: { status: string | null }) {
  const s = status ?? "unknown";
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span className={`h-2 w-2 rounded-full ${SPARE_KEY_SWATCH[s] ?? "bg-muted-foreground"}`} />
      {s.replace(/_/g, " ")}
    </Badge>
  );
}
