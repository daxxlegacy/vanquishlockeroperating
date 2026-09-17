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

/**
 * Numerical / push-button combination locks have no physical spare key, so
 * spare-key tracking does not apply to them at all. Stored variants seen in
 * the lockers table: "Numeric Lock", "Numerical Lock".
 */
export function isCombinationLock(keyLock: string | null | undefined): boolean {
  return /numeric/i.test(keyLock ?? "");
}

export function KeyBadge({ status, keyLock }: { status: string | null; keyLock?: string | null }) {
  if (isCombinationLock(keyLock)) {
    return (
      <Badge variant="outline" className="gap-1.5 text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        N/A — combination lock
      </Badge>
    );
  }
  const s = status ?? "unknown";
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span className={`h-2 w-2 rounded-full ${SPARE_KEY_SWATCH[s] ?? "bg-muted-foreground"}`} />
      {s.replace(/_/g, " ")}
    </Badge>
  );
}
