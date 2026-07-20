// Global search dropdown wired into the app header.
// Searches Lockers + Occupancy (in-memory caches) and Support Requests (live)
// in parallel, debounced. Clicking a result navigates and emits a focus
// event that the target route uses to open the relevant detail.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X, Lock, History as HistoryIcon, LifeBuoy, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useLockers } from "@/lib/lockers-cache";
import { useOccupancy, type OccupancyRow } from "@/lib/occupancy-cache";
import type { Database } from "@/integrations/supabase/types";
import { emitFocus } from "@/lib/global-focus";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

type LockerHit = { kind: "locker"; id: string; locker: string; name: string | null; badge: string | null; status: string | null };
type OccHit = { kind: "occupancy"; id: string; locker: string; name: string | null; badge: string | null; category: string };
type TicketHit = { kind: "ticket"; id: string; ticket_number: string; name: string; badge: string; status: string; request_type: string };

const MAX_PER_GROUP = 5;
const DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function matchLocker(l: Locker, q: string): boolean {
  const s = q.toLowerCase();
  return (
    (l.locker_number ?? "").toLowerCase().includes(s) ||
    (l.badge_number ?? "").toLowerCase().includes(s) ||
    (l.employee_name ?? "").toLowerCase().includes(s)
  );
}
function matchOcc(r: OccupancyRow, q: string): boolean {
  const s = q.toLowerCase();
  return (
    (r.locker_number ?? "").toLowerCase().includes(s) ||
    (r.badge_number ?? "").toLowerCase().includes(s) ||
    (r.employee_name ?? "").toLowerCase().includes(s)
  );
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [tickets, setTickets] = useState<TicketHit[]>([]);
  const [ticketLoading, setTicketLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const debouncedQ = useDebounced(q.trim(), DEBOUNCE_MS);

  const { lockers } = useLockers();
  const { rows: mainRows } = useOccupancy("main");
  const { rows: staffRows } = useOccupancy("staff");
  const { rows: shoeRows } = useOccupancy("shoe");

  // Keyboard: Cmd/Ctrl+K or "/" focuses the input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      const isEditable = (() => {
        const t = e.target as HTMLElement | null;
        if (!t) return false;
        const tag = t.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
      })();
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "/" && !isEditable && !isMod) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const lockerHits: LockerHit[] = useMemo(() => {
    if (!debouncedQ || !lockers) return [];
    const out: LockerHit[] = [];
    for (const l of lockers) {
      if (matchLocker(l, debouncedQ)) {
        out.push({
          kind: "locker",
          id: l.id,
          locker: l.locker_number,
          name: l.employee_name,
          badge: l.badge_number,
          status: l.status,
        });
        if (out.length >= MAX_PER_GROUP) break;
      }
    }
    return out;
  }, [debouncedQ, lockers]);

  const occHits: OccHit[] = useMemo(() => {
    if (!debouncedQ) return [];
    const combined = [...(mainRows ?? []), ...(staffRows ?? []), ...(shoeRows ?? [])];
    const out: OccHit[] = [];
    for (const r of combined) {
      if (matchOcc(r, debouncedQ)) {
        out.push({
          kind: "occupancy",
          id: r.id,
          locker: r.locker_number,
          name: r.employee_name,
          badge: r.badge_number,
          category: r.category,
        });
        if (out.length >= MAX_PER_GROUP) break;
      }
    }
    return out;
  }, [debouncedQ, mainRows, staffRows, shoeRows]);

  // Live query for tickets.
  useEffect(() => {
    if (!debouncedQ) {
      setTickets([]);
      setTicketLoading(false);
      return;
    }
    let cancelled = false;
    setTicketLoading(true);
    const pattern = `%${debouncedQ.replace(/[%_]/g, "\\$&")}%`;
    supabase
      .from("support_requests")
      .select("id, ticket_number, name, badge_number, status, request_type")
      .or(`ticket_number.ilike.${pattern},badge_number.ilike.${pattern},name.ilike.${pattern}`)
      .order("created_at", { ascending: false })
      .limit(MAX_PER_GROUP)
      .then(({ data, error }) => {
        if (cancelled) return;
        setTicketLoading(false);
        if (error || !data) {
          setTickets([]);
          return;
        }
        setTickets(
          data.map((t) => ({
            kind: "ticket" as const,
            id: t.id,
            ticket_number: t.ticket_number,
            name: t.name,
            badge: t.badge_number,
            status: t.status,
            request_type: t.request_type,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ]);

  const hasQuery = debouncedQ.length > 0;
  const totalHits = lockerHits.length + occHits.length + tickets.length;
  const showEmpty = hasQuery && !ticketLoading && totalHits === 0;

  function pickLocker(h: LockerHit) {
    setOpen(false);
    setQ("");
    emitFocus("locker", h.id);
    navigate({ to: "/lockers" });
  }
  function pickOcc(h: OccHit) {
    setOpen(false);
    setQ("");
    emitFocus("occupancy", h.locker);
    navigate({ to: "/occupancy" });
  }
  function pickTicket(h: TicketHit) {
    setOpen(false);
    setQ("");
    emitFocus("ticket", h.ticket_number);
    navigate({ to: "/support-requests" });
  }

  return (
    <div ref={boxRef} className="relative flex-1 max-w-sm hidden sm:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-sidebar-foreground/60" />
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search lockers, employees, tickets…  ( / )"
        className="pl-8 pr-8 h-9 bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/50"
      />
      {q ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-sidebar-foreground/60 hover:text-sidebar-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      {open && hasQuery ? (
        <div className="absolute left-0 right-0 mt-1 rounded-md border border-border bg-popover text-popover-foreground shadow-lg z-50 max-h-[70vh] overflow-y-auto text-sm">
          {lockerHits.length > 0 ? (
            <Group title="Lockers" icon={<Lock className="h-3.5 w-3.5" />}>
              {lockerHits.map((h) => (
                <button
                  key={`l-${h.id}`}
                  type="button"
                  onClick={() => pickLocker(h)}
                  className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                >
                  <span className="font-medium">{h.locker}</span>
                  <span className="text-muted-foreground truncate flex-1">
                    {h.name ?? "—"}{h.badge ? ` · ${h.badge}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{h.status ?? ""}</span>
                </button>
              ))}
            </Group>
          ) : null}

          {occHits.length > 0 ? (
            <Group title="Occupancy history" icon={<HistoryIcon className="h-3.5 w-3.5" />}>
              {occHits.map((h) => (
                <button
                  key={`o-${h.id}`}
                  type="button"
                  onClick={() => pickOcc(h)}
                  className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                >
                  <span className="font-medium">{h.locker}</span>
                  <span className="text-muted-foreground truncate flex-1">
                    {h.name ?? "—"}{h.badge ? ` · ${h.badge}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{h.category}</span>
                </button>
              ))}
            </Group>
          ) : null}

          {tickets.length > 0 ? (
            <Group title="Support tickets" icon={<LifeBuoy className="h-3.5 w-3.5" />}>
              {tickets.map((h) => (
                <button
                  key={`t-${h.id}`}
                  type="button"
                  onClick={() => pickTicket(h)}
                  className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                >
                  <span className="font-medium">#{h.ticket_number}</span>
                  <span className="text-muted-foreground truncate flex-1">
                    {h.name} · {h.badge}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{h.status}</span>
                </button>
              ))}
            </Group>
          ) : null}

          {ticketLoading && tickets.length === 0 && lockerHits.length === 0 && occHits.length === 0 ? (
            <div className="px-3 py-4 text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : null}

          {showEmpty ? (
            <div className="px-3 py-4 text-muted-foreground text-center">No results found</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Group({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
