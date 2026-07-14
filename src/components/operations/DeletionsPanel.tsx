import { useEffect, useMemo, useState } from "react";
import { getXLSX } from "@/lib/xlsx-lazy";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, Undo2, CheckCircle2, Clock, Download, Search, X } from "lucide-react";
import { toast } from "sonner";
import { undoDeletion, UNDO_WINDOW_MS } from "@/lib/delete-actions";
import type { Database } from "@/integrations/supabase/types";

type Audit = Database["public"]["Tables"]["deletion_audit"]["Row"];

export function DeletionsPanel() {
  const { user, role } = useAuth();
  const [items, setItems] = useState<Audit[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase.from("deletion_audit").select("*").order("created_at", { ascending: false }).limit(1000)
      .then(({ data }) => setItems(data ?? []));
  }, [user, refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const inRange = (iso: string) => {
    const d = new Date(iso).getTime();
    if (fromDate && d < new Date(fromDate + "T00:00:00").getTime()) return false;
    if (toDate && d > new Date(toDate + "T23:59:59").getTime()) return false;
    return true;
  };

  const q = search.trim().toLowerCase();
  const filteredItems = useMemo(() => (items ?? []).filter((a) => {
    if (!inRange(a.created_at)) return false;
    if (!q) return true;
    return (
      (a.locker_number ?? "").toLowerCase().includes(q) ||
      (a.location ?? "").toLowerCase().includes(q) ||
      (a.reason ?? "").toLowerCase().includes(q) ||
      (a.deleted_by_email ?? "").toLowerCase().includes(q)
    );
  }), [items, q, fromDate, toDate]);

  const exportDeletions = (fmt: "xlsx" | "csv") => {
    const rows = filteredItems.map((a) => ({
      kind: a.deletion_kind, locker_number: a.locker_number ?? "", location: a.location,
      affected_count: a.affected_count, affected_lockers: (a.affected_locker_numbers ?? []).join(", "),
      reason: a.reason, deleted_by: a.deleted_by_email ?? a.deleted_by,
      deleted_at: new Date(a.created_at).toLocaleString(),
      restored_at: a.undone_at ? new Date(a.undone_at).toLocaleString() : "",
    }));
    if (rows.length === 0) { toast.error("No rows to export."); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const dl = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (fmt === "csv") {
      dl(new Blob([Papa.unparse(rows)], { type: "text/csv;charset=utf-8;" }), `deletions-${stamp}.csv`);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Deletions");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      dl(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `deletions-${stamp}.xlsx`);
    }
    toast.success(`Exported ${rows.length} deletion${rows.length === 1 ? "" : "s"}.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <History className="h-5 w-5" />
        <h2 className="font-display text-xl font-bold">Deletion audit</h2>
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr,auto,auto,auto] gap-3 items-end">
          <div>
            <Label htmlFor="q" className="text-xs uppercase tracking-wide text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input id="q" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Locker #, location, reason…" />
            </div>
          </div>
          <div>
            <Label htmlFor="from" className="text-xs uppercase tracking-wide text-muted-foreground">From</Label>
            <Input id="from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs uppercase tracking-wide text-muted-foreground">To</Label>
            <Input id="to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFromDate(""); setToDate(""); }}>
            <X className="h-4 w-4 mr-1" /> Clear
          </Button>
        </div>
      </Card>

      {role === "admin" && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => exportDeletions("xlsx")}><Download className="h-4 w-4 mr-1" /> Excel</Button>
          <Button variant="outline" size="sm" onClick={() => exportDeletions("csv")}><Download className="h-4 w-4 mr-1" /> CSV</Button>
        </div>
      )}

      {!items ? (
        <Skeleton className="h-96 w-full" />
      ) : filteredItems.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No deletions match.</Card>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((a) => {
            const ageMs = now - new Date(a.created_at).getTime();
            const remainingMs = UNDO_WINDOW_MS - ageMs;
            const restorable = !a.undone_at && remainingMs > 0;
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={a.deletion_kind === "location" ? "destructive" : "outline"} className="capitalize">{a.deletion_kind}</Badge>
                      {a.deletion_kind === "locker"
                        ? <span className="font-mono font-semibold">{a.locker_number}</span>
                        : <span className="font-semibold">{a.location}</span>}
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-sm text-muted-foreground">{a.affected_count} locker{a.affected_count === 1 ? "" : "s"}</span>
                      {a.undone_at ? (
                        <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Restored
                        </Badge>
                      ) : restorable ? (
                        <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/40 gap-1">
                          <Clock className="h-3 w-3" /> {Math.ceil(remainingMs / 60_000)} min left
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Window closed</Badge>
                      )}
                    </div>
                    <p className="text-sm mt-2"><span className="text-muted-foreground">Reason:</span> {a.reason}</p>
                    <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>By: {a.deleted_by_email ?? a.deleted_by.slice(0, 8)}</span>
                      <span>When: {new Date(a.created_at).toLocaleString()}</span>
                      <span>Location: {a.location}</span>
                    </div>
                    {a.deletion_kind === "location" && a.affected_locker_numbers && a.affected_locker_numbers.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          Show affected lockers ({a.affected_locker_numbers.length})
                        </summary>
                        <ScrollArea className="h-32 mt-2 rounded border p-2">
                          <div className="flex flex-wrap gap-1">
                            {a.affected_locker_numbers.map((n) => (
                              <span key={n} className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted border">{n}</span>
                            ))}
                          </div>
                        </ScrollArea>
                      </details>
                    )}
                  </div>
                  {role === "admin" && restorable && (
                    <Button variant="outline" size="sm" onClick={async () => {
                      try {
                        const c = await undoDeletion(a.id);
                        toast.success(`Restored ${c} locker${c === 1 ? "" : "s"}`);
                        setRefresh((k) => k + 1);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Restore failed");
                      }
                    }}>
                      <Undo2 className="h-4 w-4 mr-1" /> Restore
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
