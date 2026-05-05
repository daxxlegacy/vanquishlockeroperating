// Click a locker number on the map → see all compartments (A–F) for that prefix.
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { STATUS_CELL, STATUS_SWATCH, STATUS_LABEL, LOCKER_STATUSES, type LockerStatus } from "@/lib/locker-status";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

const NOT_PRESENT = "bg-background border-dashed border-border text-muted-foreground/70";

const SLOTS = ["A", "B", "C", "D", "E", "F"] as const;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  number: string;
  /** All locker rows that share this number prefix (one per row letter). */
  compartments: Locker[];
  onSelectLocker: (id: string) => void;
}

function rowLetter(l: Locker): string | undefined {
  return l.row_label?.match(/\b([A-F])\b/i)?.[1]?.toUpperCase();
}

export function CompartmentPopover({ open, onOpenChange, number, compartments, onSelectLocker }: Props) {
  // Map slot letter -> locker (if any)
  const bySlot = new Map<string, Locker>();
  for (const l of compartments) {
    const r = rowLetter(l);
    if (r) bySlot.set(r, l);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Locker {number} — compartments</DialogTitle>
          <DialogDescription>Click a compartment to open its details.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-3">
          {SLOTS.map((slot) => {
            const l = bySlot.get(slot);
            const cls = l ? SLOT_COLORS[l.status] ?? SLOT_COLORS.unknown : NOT_PRESENT;
            return (
              <button
                key={slot}
                onClick={() => l && onSelectLocker(l.id)}
                disabled={!l}
                className={`rounded-md border-2 ${cls} ${
                  l ? "cursor-pointer hover:ring-2 hover:ring-ring" : "cursor-not-allowed"
                } p-3 text-left transition-all min-h-[80px] flex flex-col justify-between`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-display font-bold text-lg">{slot}</span>
                  {l && <span className="text-[10px] uppercase tracking-wide opacity-90">{l.status}</span>}
                </div>
                <div className="text-[11px] leading-tight mt-1 break-words">
                  {l ? (
                    l.employee_name ? <span className="font-medium">{l.employee_name}</span> : <span className="opacity-80">— empty —</span>
                  ) : (
                    <span className="italic">not in DB</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-2 border-t">
          <Legend c="bg-destructive" l="Occupied" />
          <Legend c="bg-success" l="Empty" />
          <Legend c="bg-warning" l="Repair" />
          <Legend c="bg-muted-foreground" l="Unknown / not in DB" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Legend({ c, l }: { c: string; l: string }) {
  return <span className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded ${c}`} />{l}</span>;
}
