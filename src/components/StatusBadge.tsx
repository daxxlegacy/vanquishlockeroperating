import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) {
    return <span className="text-muted-foreground">—</span>;
  }
  const swatch = STATUS_SWATCH[status as LockerStatus] ?? "bg-muted-foreground";
  const label = STATUS_LABEL[status as LockerStatus] ?? status;
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </Badge>
  );
}
