// Click a locker label on the map → see all its compartments and pick one.
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
  /** All locker rows that share this number prefix. */
  compartments: Locker[];
  onSelectLocker: (id: string) => void;
}

function rowLetter(l: Locker): string | undefined {
  const fromNumber = l.locker_number?.toUpperCase().match(/([A-F])$/)?.[1];
  if (fromNumber) return fromNumber;
  return l.row_label?.match(/\b([A-F])\b/i)?.[1]?.toUpperCase();
}

/** True if compartments are letter-suffixed (e.g. 6075A..F) — show as A-F grid. */
function isLetterSeries(compartments: Locker[]): boolean {
  if (compartments.length === 0) return true;
  return compartments.every((l) => /[A-F]$/i.test(l.locker_number));
}

export function CompartmentPopover({ open, onOpenChange, number, compartments, onSelectLocker }: Props) {
  const letterMode = isLetterSeries(compartments);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={letterMode ? "max-w-md" : "max-w-3xl"}>
        <DialogHeader>
          <DialogTitle className="font-display">Locker {number} — compartments</DialogTitle>
          <DialogDescription>
            {compartments.length} compartment{compartments.length === 1 ? "" : "s"}. Click one to open its details.
          </DialogDescription>
        </DialogHeader>

        {letterMode ? (
          <LetterGrid number={number} compartments={compartments} onSelectLocker={onSelectLocker} />
        ) : (
          <NumberGrid compartments={compartments} onSelectLocker={onSelectLocker} />
        )}

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground pt-2 border-t">
          {LOCKER_STATUSES.map((s) => (
            <Legend key={s} c={STATUS_SWATCH[s as LockerStatus]} l={STATUS_LABEL[s as LockerStatus]} />
          ))}
          <Legend c="bg-background border border-dashed border-border" l="Not in DB" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LetterGrid({
  number,
  compartments,
  onSelectLocker,
}: {
  number: string;
  compartments: Locker[];
  onSelectLocker: (id: string) => void;
}) {
  const bySlot = new Map<string, Locker>();
  for (const l of compartments) {
    const r = rowLetter(l);
    if (r) bySlot.set(r, l);
  }
  return (
    <div className="grid grid-cols-3 gap-3 py-3">
      {SLOTS.map((slot) => {
        const l = bySlot.get(slot);
        const cls = l ? STATUS_CELL[l.status as LockerStatus] ?? STATUS_CELL.unknown : NOT_PRESENT;
        const fullCode = `${number}${slot}`;
        return (
          <button
            key={slot}
            onClick={() => l && onSelectLocker(l.id)}
            disabled={!l}
            className={`rounded-md border-2 ${cls} ${
              l ? "cursor-pointer hover:ring-2 hover:ring-ring" : "cursor-not-allowed"
            } p-3 text-left transition-all min-h-[88px] flex flex-col justify-between`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display font-bold text-lg leading-none">{fullCode}</span>
              {l && <span className="text-[10px] uppercase tracking-wide opacity-90">{STATUS_LABEL[l.status as LockerStatus]}</span>}
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
  );
}

function NumberGrid({
  compartments,
  onSelectLocker,
}: {
  compartments: Locker[];
  onSelectLocker: (id: string) => void;
}) {
  const sorted = [...compartments].sort((a, b) =>
    a.locker_number.localeCompare(b.locker_number, undefined, { numeric: true }),
  );
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 py-3 max-h-[60vh] overflow-auto">
      {sorted.map((l) => {
        const cls = STATUS_CELL[l.status as LockerStatus] ?? STATUS_CELL.unknown;
        return (
          <button
            key={l.id}
            onClick={() => onSelectLocker(l.id)}
            className={`rounded-md border-2 ${cls} cursor-pointer hover:ring-2 hover:ring-ring p-2 text-left transition-all min-h-[68px] flex flex-col justify-between`}
            title={l.employee_name ?? "empty"}
          >
            <span className="font-display font-bold text-sm leading-none">{l.locker_number}</span>
            <span className="text-[10px] leading-tight mt-1 break-words line-clamp-2">
              {l.employee_name ?? "— empty —"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Legend({ c, l }: { c: string; l: string }) {
  return <span className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded ${c}`} />{l}</span>;
}
