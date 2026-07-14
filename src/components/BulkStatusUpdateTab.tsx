// Bulk Status Update tab — updates ONLY locker_number + status.
// Never touches employee_name, badge_number, or national_id.
import { useMemo, useState } from "react";
import { getXLSX } from "@/lib/xlsx-lazy";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pauseLockersRealtime, invalidateLockersCache } from "@/lib/lockers-cache";
import { invalidateOccupancyCache } from "@/lib/occupancy-cache";
import { LOCKER_STATUSES, STATUS_LABEL, type LockerStatus } from "@/lib/locker-status";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { ClipboardList, CheckCircle2, Download } from "lucide-react";

type Action = "UPDATE" | "NO_CHANGE" | "NOT_FOUND" | "ERROR";

type ParsedRow = {
  rowIndex: number;
  locker_number: string;
  raw_status: string;
  new_status: LockerStatus | null;
  action: Action;
  current_status: string | null;
  locker_id: string | null;
  reason?: string;
};

type DbLocker = { id: string; locker_number: string; status: string | null };

const CLEAN = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\u2060/g, "").trim();

const STATUS_SET = new Set<string>(LOCKER_STATUSES);

function normalizeStatusInput(raw: string): LockerStatus | null {
  if (!raw) return null;
  const n = raw.toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_").trim();
  return STATUS_SET.has(n) ? (n as LockerStatus) : null;
}

function findHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    for (const cell of row) {
      if (typeof cell === "string" && /locker\s*number/i.test(cell)) return i;
    }
  }
  return -1;
}

function findCol(headers: string[], ...patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] ?? "";
    for (const p of patterns) if (p.test(h)) return i;
  }
  return -1;
}

export function BulkStatusUpdateTab() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set()); // rowIndex keys
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ updated: number; skipped: number; errors: number } | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  const reset = () => {
    setFile(null); setRows([]); setExcluded(new Set());
    setProgress(null); setResult(null);
  };

  const handleFile = async (f: File) => {
    reset();
    setFile(f);
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const XLSX = await getXLSX();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
      const headerRowIdx = findHeaderRow(aoa);
      if (headerRowIdx < 0) {
        toast.error('Could not find a "Locker Number" header row.');
        setParsing(false);
        return;
      }
      const headers = (aoa[headerRowIdx] ?? []).map((c) => (c == null ? "" : String(c)));
      const cLocker = findCol(headers, /locker\s*number/i);
      const cStatus = findCol(headers, /new\s*status/i, /^status$/i);
      if (cLocker < 0 || cStatus < 0) {
        toast.error('File must have "Locker Number" and "New Status" columns.');
        setParsing(false);
        return;
      }

      const parsed: ParsedRow[] = [];
      for (let i = headerRowIdx + 1; i < aoa.length; i++) {
        const r = aoa[i] ?? [];
        const locker = CLEAN(r[cLocker]);
        const raw = CLEAN(r[cStatus]);
        if (!locker && !raw) continue;
        if (!locker) continue;
        const newStatus = normalizeStatusInput(raw);
        parsed.push({
          rowIndex: i + 1,
          locker_number: locker,
          raw_status: raw,
          new_status: newStatus,
          action: "ERROR",
          current_status: null,
          locker_id: null,
          reason: !raw ? "Missing New Status" : newStatus ? undefined : `Invalid status "${raw}"`,
        });
      }

      // Lookup existing lockers
      const dbMap = new Map<string, DbLocker>();
      const lockerNums = parsed.map((r) => r.locker_number);
      const CHUNK = 200;
      for (let i = 0; i < lockerNums.length; i += CHUNK) {
        const slice = lockerNums.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("lockers")
          .select("id, locker_number, status")
          .is("deleted_at", null)
          .in("locker_number", slice);
        if (error) { toast.error(`DB lookup failed: ${error.message}`); break; }
        for (const row of data ?? []) dbMap.set(row.locker_number, row as DbLocker);
      }

      const initialExcluded = new Set<number>();
      for (const r of parsed) {
        const db = dbMap.get(r.locker_number);
        if (!db) { r.action = "NOT_FOUND"; initialExcluded.add(r.rowIndex); continue; }
        r.locker_id = db.id;
        r.current_status = db.status;
        if (!r.new_status) { r.action = "ERROR"; initialExcluded.add(r.rowIndex); continue; }
        if ((db.status ?? "") === r.new_status) { r.action = "NO_CHANGE"; initialExcluded.add(r.rowIndex); continue; }
        r.action = "UPDATE";
      }

      setRows(parsed);
      setExcluded(initialExcluded);
      const updates = parsed.filter((r) => r.action === "UPDATE").length;
      toast.success(`Parsed ${parsed.length} row${parsed.length === 1 ? "" : "s"} — ${updates} ready to update.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
    setParsing(false);
  };

  const counts = useMemo(() => {
    let u = 0, nc = 0, nf = 0, er = 0;
    for (const r of rows) {
      if (r.action === "UPDATE") u++;
      else if (r.action === "NO_CHANGE") nc++;
      else if (r.action === "NOT_FOUND") nf++;
      else er++;
    }
    return { u, nc, nf, er };
  }, [rows]);

  const toggle = (idx: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleDownloadTemplate = async () => {
    setTemplateBusy(true);
    try {
      const all: { locker_number: string; status: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("locker_number, status")
          .is("deleted_at", null)
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      all.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
      const aoa: (string | null)[][] = [["Locker Number", "New Status"]];
      for (const r of all) aoa.push([r.locker_number, r.status ?? ""]);
      const XLSX = await getXLSX();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 18 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bulk Status");
      XLSX.writeFile(wb, `bulk-status-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Template exported with ${all.length} lockers.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export template");
    }
    setTemplateBusy(false);
  };

  const handleApply = async () => {
    const toApply = rows.filter((r) => r.action === "UPDATE" && !excluded.has(r.rowIndex));
    if (toApply.length === 0) { toast.warning("Nothing to apply."); return; }
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    const userEmail = userData.user?.email ?? null;
    if (!userId) { toast.error("Not signed in."); return; }

    setApplying(true);
    setProgress({ done: 0, total: toApply.length });
    const resume = pauseLockersRealtime();
    let updated = 0, skipped = 0, errors = 0;
    const auditRows: {
      locker_id: string | null; locker_number: string;
      previous_status: string | null; new_status: string;
      source: string; changed_by: string; changed_by_email: string | null;
    }[] = [];
    const BATCH = 40;
    const { syncStatusChangeToOccupancy, syncActivationToOccupancy } = await import("@/lib/occupancy-sync");
    try {
      for (let i = 0; i < toApply.length; i += BATCH) {
        const slice = toApply.slice(i, i + BATCH);
        await Promise.all(slice.map(async (r) => {
          const newStatus = r.new_status!;
          const { data: updatedRows, error } = await supabase
            .from("lockers")
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq("locker_number", r.locker_number)
            .select("*");
          if (error) { errors++; return; }
          if (!updatedRows || updatedRows.length === 0) { skipped++; return; }
          updated++;
          const updatedLocker = updatedRows[0];
          // Keep locker_occupancy in sync with the new status. Route through the
          // canonical sync helpers so future drift stays impossible.
          try {
            if (newStatus === "active") await syncActivationToOccupancy(updatedLocker);
            else await syncStatusChangeToOccupancy(updatedLocker);
          } catch (e) { console.warn(`occupancy sync failed for ${r.locker_number}:`, e); }
          auditRows.push({
            locker_id: r.locker_id,
            locker_number: r.locker_number,
            previous_status: r.current_status,
            new_status: newStatus,
            source: "bulk_status_update",
            changed_by: userId,
            changed_by_email: userEmail,
          });
        }));
        setProgress({ done: Math.min(i + BATCH, toApply.length), total: toApply.length });
      }

      // Insert audit log in chunks (non-fatal on failure).
      for (let i = 0; i < auditRows.length; i += 200) {
        const chunk = auditRows.slice(i, i + 200);
        const { error } = await supabase.from("status_change_log").insert(chunk);
        if (error) console.warn("status_change_log insert failed:", error.message);
      }
    } finally {
      resume();
      invalidateLockersCache();
      invalidateOccupancyCache();
    }
    setResult({ updated, skipped, errors });
    setApplying(false);
    toast.success(`Applied: ${updated} updated, ${skipped} skipped, ${errors} error${errors === 1 ? "" : "s"}.`);
  };

  if (result) {
    return (
      <Card className="mt-6 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <h2 className="font-display text-xl font-bold">Bulk Status Update Applied</h2>
        </div>
        <div className="text-sm">
          <span className="text-success font-semibold">{result.updated}</span> lockers updated ·{" "}
          <span className="text-muted-foreground">{result.skipped}</span> skipped ·{" "}
          <span className={result.errors > 0 ? "text-destructive" : "text-muted-foreground"}>{result.errors}</span> errors
        </div>
        <Button onClick={reset}>Done</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="mt-6 p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <Label htmlFor="bulk-status-file" className="text-base font-display">Choose bulk status file</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Excel/CSV with two columns: <code className="bg-muted px-1 rounded">Locker Number</code> and{" "}
              <code className="bg-muted px-1 rounded">New Status</code>. Only status is updated — identity fields are never touched.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate} disabled={templateBusy}>
            <Download className="h-4 w-4 mr-1.5" />
            {templateBusy ? "Preparing…" : "Download Template"}
          </Button>
        </div>
        <div className="flex gap-3 items-center">
          <Input
            id="bulk-status-file"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="cursor-pointer"
          />
          {parsing && <Badge variant="secondary">Parsing…</Badge>}
          {file && !parsing && <span className="text-xs text-muted-foreground truncate">{file.name}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          Valid statuses: {LOCKER_STATUSES.map((s) => STATUS_LABEL[s]).join(", ")}.
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Preview</h2>
          </div>
          <div className="text-sm">
            <span className="text-success font-semibold">{counts.u}</span> to update ·{" "}
            <span className="text-muted-foreground">{counts.nc}</span> no change ·{" "}
            <span className="text-destructive font-semibold">{counts.nf}</span> not found ·{" "}
            <span className="text-warning font-semibold">{counts.er}</span> errors
          </div>

          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-2 py-1.5 w-8"></th>
                  <th className="px-2 py-1.5">Locker #</th>
                  <th className="px-2 py-1.5">Current Status</th>
                  <th className="px-2 py-1.5">New Status</th>
                  <th className="px-2 py-1.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const canToggle = r.action === "UPDATE" || r.action === "NO_CHANGE";
                  const checked = !excluded.has(r.rowIndex);
                  return (
                    <tr key={r.rowIndex} className="border-t">
                      <td className="px-2 py-1">
                        {canToggle ? (
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggle(r.rowIndex)}
                            aria-label={`Include ${r.locker_number}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-1 font-medium">{r.locker_number}</td>
                      <td className="px-2 py-1"><StatusBadge status={r.current_status} /></td>
                      <td className="px-2 py-1">
                        {r.new_status ? <StatusBadge status={r.new_status} /> : <span className="text-muted-foreground italic">{r.raw_status || "—"}</span>}
                      </td>
                      <td className="px-2 py-1">
                        {r.action === "UPDATE" && (
                          <Badge variant="outline" className="border-success text-success">UPDATE</Badge>
                        )}
                        {r.action === "NO_CHANGE" && (
                          <Badge variant="outline" className="border-muted-foreground text-muted-foreground">NO CHANGE</Badge>
                        )}
                        {r.action === "NOT_FOUND" && (
                          <Badge variant="outline" className="border-destructive text-destructive">NOT FOUND</Badge>
                        )}
                        {r.action === "ERROR" && (
                          <Badge variant="outline" className="border-warning text-warning">{r.reason ?? "ERROR"}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleApply}
              disabled={applying || rows.filter((r) => r.action === "UPDATE" && !excluded.has(r.rowIndex)).length === 0}
            >
              {applying ? "Applying…" : "Apply Changes"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Will update {rows.filter((r) => r.action === "UPDATE" && !excluded.has(r.rowIndex)).length} locker
              {rows.filter((r) => r.action === "UPDATE" && !excluded.has(r.rowIndex)).length === 1 ? "" : "s"}
            </span>
          </div>

          {applying && progress && (
            <div className="space-y-1">
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
              <p className="text-xs text-muted-foreground">{progress.done} / {progress.total}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
