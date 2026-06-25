import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";

interface Props {
  status: string | null | undefined;
  customStatus?: string | null;
}

export function StatusBadge({ status, customStatus }: Props) {
  const custom = (customStatus ?? "").trim();
  if (custom) {
    return (
      <Badge variant="outline" className="gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300">
        <span className="h-2 w-2 rounded-full bg-violet-500" />
        {custom}
      </Badge>
    );
  }
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
