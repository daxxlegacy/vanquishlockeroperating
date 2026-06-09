import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortState = { col: string; dir: "asc" | "desc" } | null;

/** Clickable column header label that cycles sort state. Designed to sit
 * next to a `<ColumnFilter />` inside a header cell. */
export function SortHeader({
  label,
  col,
  sort,
  onCycle,
}: {
  label: string;
  col: string;
  sort: SortState;
  onCycle: (col: string) => void;
}) {
  const active = sort?.col === col;
  const Icon = !active ? ArrowUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onCycle(col); }}
      className={`inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-muted ${
        active ? "text-foreground" : ""
      }`}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
    </button>
  );
}
