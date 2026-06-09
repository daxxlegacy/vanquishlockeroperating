import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Search, X, ChevronRight } from "lucide-react";

/**
 * Excel-style per-column filter dropdown.
 *
 * When `label === "Batch"`, render a 3-level Year → Month → Day tree
 * (Excel-style date grouping). Non-date values (blanks, free text)
 * fall through to an "Other" section at the bottom and behave like the
 * flat checkbox list used by every other column.
 *
 * The selected Set<string> still stores individual dd/mm/yyyy strings
 * (or the BLANK marker) so passesColumnFilter keeps working unchanged.
 */
const BLANK = "(Blanks)";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function parseDdMmYyyy(v: string): { y: number; m: number; d: number } | null {
  const m = v.match(DATE_RE);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

export function ColumnFilter({
  values,
  selected,
  onChange,
  label,
}: {
  values: (string | null | undefined)[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(selected);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set()); // "y-m"

  const isBatch = label === "Batch";

  // Reset draft each time the popover opens so cancelling discards changes.
  const onOpenChange = (v: boolean) => {
    if (v) {
      setDraft(new Set(selected));
      setSearch("");
      setAddMode(false);
      setExpandedYears(new Set());
      setExpandedMonths(new Set());
    }
    setOpen(v);
  };

  const unique = useMemo(() => {
    const set = new Set<string>();
    for (const v of values) {
      const s = v == null || v === "" ? BLANK : String(v);
      set.add(s);
    }
    return [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [values]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return unique;
    return unique.filter((v) => v.toLowerCase().includes(q));
  }, [unique, search]);

  // Split filtered values into dates + others (for Batch mode).
  const { dateTree, others } = useMemo(() => {
    const others: string[] = [];
    // year -> month -> Map<dateString, count>
    const tree = new Map<number, Map<number, Map<string, number>>>();
    if (!isBatch) return { dateTree: tree, others };
    for (const v of filtered) {
      const parsed = v === BLANK ? null : parseDdMmYyyy(v);
      if (!parsed) {
        others.push(v);
        continue;
      }
      let ym = tree.get(parsed.y);
      if (!ym) { ym = new Map(); tree.set(parsed.y, ym); }
      let dm = ym.get(parsed.m);
      if (!dm) { dm = new Map(); ym.set(parsed.m, dm); }
      dm.set(v, (dm.get(v) ?? 0) + 1);
    }
    return { dateTree: tree, others };
  }, [filtered, isBatch]);

  const allFilteredChecked = filtered.length > 0 && filtered.every((v) => draft.has(v));

  const toggle = (v: string, checked: boolean) => {
    const next = new Set(draft);
    if (checked) next.add(v);
    else next.delete(v);
    setDraft(next);
  };

  const toggleMany = (vals: string[], checked: boolean) => {
    const next = new Set(draft);
    for (const v of vals) {
      if (checked) next.add(v);
      else next.delete(v);
    }
    setDraft(next);
  };

  const toggleAllFiltered = (checked: boolean) => {
    const next = new Set(draft);
    if (!addMode && search.trim() === "") {
      if (checked) for (const v of unique) next.add(v);
      else next.clear();
      setDraft(next);
      return;
    }
    if (!addMode) next.clear();
    for (const v of filtered) {
      if (checked) next.add(v);
      else next.delete(v);
    }
    setDraft(next);
  };

  const apply = () => {
    if (draft.size === 0 || draft.size === unique.length) onChange(new Set());
    else onChange(new Set(draft));
    setOpen(false);
  };

  const clear = () => {
    onChange(new Set());
    setOpen(false);
  };

  const active = selected.size > 0;

  // Render tri-state for year / month rows.
  const triState = (vals: string[]): boolean | "indeterminate" => {
    if (vals.length === 0) return false;
    let on = 0;
    for (const v of vals) if (draft.has(v)) on++;
    if (on === 0) return false;
    if (on === vals.length) return true;
    return "indeterminate";
  };

  const toggleYear = (y: number) => {
    const next = new Set(expandedYears);
    if (next.has(y)) next.delete(y); else next.add(y);
    setExpandedYears(next);
  };
  const toggleMonth = (y: number, m: number) => {
    const k = `${y}-${m}`;
    const next = new Set(expandedMonths);
    if (next.has(k)) next.delete(k); else next.add(k);
    setExpandedMonths(next);
  };

  const sortedYears = useMemo(
    () => [...dateTree.keys()].sort((a, b) => b - a),
    [dateTree],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted ${
            active ? "text-primary" : "text-muted-foreground"
          }`}
          aria-label={label ? `Filter ${label}` : "Filter column"}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className={`h-3.5 w-3.5 ${active ? "fill-current" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-7 pr-7 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer">
            <Checkbox
              checked={allFilteredChecked}
              onCheckedChange={(c) => toggleAllFiltered(c === true)}
            />
            <span className="font-medium">
              {search.trim() ? "(Select All Search Results)" : "(Select All)"}
            </span>
          </label>
          {search.trim() && (
            <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer">
              <Checkbox
                checked={addMode}
                onCheckedChange={(c) => setAddMode(c === true)}
              />
              <span className="text-muted-foreground">Add current selection to filter</span>
            </label>
          )}
          <div className="max-h-64 overflow-y-auto border-t pt-1 mt-1">
            {isBatch ? (
              sortedYears.length === 0 && others.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">No values</div>
              ) : (
                <>
                  {sortedYears.map((y) => {
                    const months = dateTree.get(y)!;
                    const yearVals: string[] = [];
                    for (const dm of months.values()) for (const v of dm.keys()) yearVals.push(v);
                    const yState = triState(yearVals);
                    const yExpanded = expandedYears.has(y);
                    const sortedMonths = [...months.keys()].sort((a, b) => a - b);
                    return (
                      <div key={y}>
                        <div className="flex items-center gap-1 px-1 py-1 rounded hover:bg-muted">
                          <button
                            type="button"
                            onClick={() => toggleYear(y)}
                            className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground"
                            aria-label={yExpanded ? "Collapse" : "Expand"}
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition-transform ${yExpanded ? "rotate-90" : ""}`}
                            />
                          </button>
                          <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                            <Checkbox
                              checked={yState}
                              onCheckedChange={(c) => toggleMany(yearVals, c === true)}
                            />
                            <span className="truncate font-medium">{y}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{yearVals.length}</span>
                          </label>
                        </div>
                        {yExpanded && sortedMonths.map((m) => {
                          const dm = months.get(m)!;
                          const monthVals = [...dm.keys()];
                          const mState = triState(monthVals);
                          const mKey = `${y}-${m}`;
                          const mExpanded = expandedMonths.has(mKey);
                          const sortedDates = monthVals.sort((a, b) => {
                            const pa = parseDdMmYyyy(a)!;
                            const pb = parseDdMmYyyy(b)!;
                            return pa.d - pb.d;
                          });
                          return (
                            <div key={m}>
                              <div className="flex items-center gap-1 pl-5 pr-1 py-1 rounded hover:bg-muted">
                                <button
                                  type="button"
                                  onClick={() => toggleMonth(y, m)}
                                  className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground"
                                  aria-label={mExpanded ? "Collapse" : "Expand"}
                                >
                                  <ChevronRight
                                    className={`h-3.5 w-3.5 transition-transform ${mExpanded ? "rotate-90" : ""}`}
                                  />
                                </button>
                                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                                  <Checkbox
                                    checked={mState}
                                    onCheckedChange={(c) => toggleMany(monthVals, c === true)}
                                  />
                                  <span className="truncate">{MONTH_NAMES[m - 1]}</span>
                                  <span className="text-xs text-muted-foreground ml-auto">{monthVals.length}</span>
                                </label>
                              </div>
                              {mExpanded && sortedDates.map((v) => (
                                <label
                                  key={v}
                                  className="flex items-center gap-2 pl-10 pr-1 py-1 rounded hover:bg-muted cursor-pointer"
                                >
                                  <Checkbox
                                    checked={draft.has(v)}
                                    onCheckedChange={(c) => toggle(v, c === true)}
                                  />
                                  <span className="truncate">{v}</span>
                                  <span className="text-xs text-muted-foreground ml-auto">{dm.get(v)}</span>
                                </label>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {others.length > 0 && (
                    <div className="mt-2 pt-2 border-t">
                      <div className="px-1 py-1 text-xs text-muted-foreground font-medium">Other</div>
                      {others.map((v) => (
                        <label
                          key={v}
                          className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer"
                        >
                          <Checkbox
                            checked={draft.has(v)}
                            onCheckedChange={(c) => toggle(v, c === true)}
                          />
                          <span className={`truncate ${v === BLANK ? "italic text-muted-foreground" : ""}`}>
                            {v}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )
            ) : filtered.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">No values</div>
            ) : (
              filtered.map((v) => (
                <label
                  key={v}
                  className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer"
                >
                  <Checkbox
                    checked={draft.has(v)}
                    onCheckedChange={(c) => toggle(v, c === true)}
                  />
                  <span className={`truncate ${v === BLANK ? "italic text-muted-foreground" : ""}`}>
                    {v}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
        <div className="flex justify-between gap-2 pt-2 mt-2 border-t">
          <Button variant="ghost" size="sm" onClick={clear} className="h-7 text-xs">
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} className="h-7 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={apply} className="h-7 text-xs">
              OK
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Helper: row value passes a column filter (selected set). */
export function passesColumnFilter(value: string | null | undefined, selected: Set<string>) {
  if (selected.size === 0) return true;
  const v = value == null || value === "" ? BLANK : String(value);
  return selected.has(v);
}
