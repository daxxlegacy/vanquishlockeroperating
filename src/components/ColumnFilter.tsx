import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Search, X } from "lucide-react";

/**
 * Excel-style per-column filter dropdown.
 *
 *  - Search box narrows the checkbox list to "search results".
 *  - "(Select All Search Results)" toggles every value currently matching
 *    the search.
 *  - "Add current selection to filter" preserves prior selections that fall
 *    outside the current search instead of replacing them. (Same semantics
 *    as the Excel popup the user referenced.)
 *
 *  `selected` is the set of values currently included by the filter. An
 *  empty set means "no filter" (everything passes). When the user picks
 *  values the parent stores them; the parent applies the predicate
 *  `selected.size === 0 || selected.has(value)` to each row.
 */
const BLANK = "(Blanks)";

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

  // Reset draft each time the popover opens so cancelling discards changes.
  const onOpenChange = (v: boolean) => {
    if (v) {
      setDraft(new Set(selected));
      setSearch("");
      setAddMode(false);
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

  const allFilteredChecked = filtered.length > 0 && filtered.every((v) => draft.has(v));

  const toggle = (v: string, checked: boolean) => {
    const next = new Set(draft);
    if (checked) next.add(v);
    else next.delete(v);
    setDraft(next);
  };

  const toggleAllFiltered = (checked: boolean) => {
    const next = new Set(draft);
    if (!addMode && search.trim() === "") {
      // No search: select-all toggles every value, no merge with prior state.
      if (checked) for (const v of unique) next.add(v);
      else next.clear();
      setDraft(next);
      return;
    }
    if (!addMode) {
      // Search active, "Add" off → start from only the filtered selection.
      next.clear();
    }
    for (const v of filtered) {
      if (checked) next.add(v);
      else next.delete(v);
    }
    setDraft(next);
  };

  const apply = () => {
    // Normalise: if user picked every value, treat as "no filter".
    if (draft.size === 0 || draft.size === unique.length) onChange(new Set());
    else onChange(new Set(draft));
    setOpen(false);
  };

  const clear = () => {
    onChange(new Set());
    setOpen(false);
  };

  const active = selected.size > 0;

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
            {filtered.length === 0 ? (
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
