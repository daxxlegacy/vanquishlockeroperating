// Record Intake upload tab — parses locker intake Excel files
// (e.g. "Locker_List_at_09_June_2026__FW__128_.xlsx") and applies them to
// the lockers table. Self-contained; pulled in by /upload.
import { useMemo, useState } from "react";
import { getXLSX } from "@/lib/xlsx-lazy";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pauseLockersRealtime, invalidateLockersCache } from "@/lib/lockers-cache";
import { parseBatchIntake, formatBatchIntake } from "@/lib/locker-utils";
import { maskNationalId } from "@/lib/national-id";
import { syncActivationToOccupancy } from "@/lib/occupancy-sync";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, ClipboardList, CheckCircle2, AlertTriangle } from "lucide-react";

type IntakeRow = {
  rowIndex: number;
  locker_number: string;
  employee_name: string;
  badge_number: string;
  national_id: string;
  work_location: string;
  batch_intake: unknown; // raw — parsed at apply time
};

type IgnoredRow = {
  rowIndex: number;
  locker_number: string;
  employee_name: string;
  reason: string;
};

type DbState = {
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  national_id: string | null;
  work_location: string | null;
  status: string | null;
};

type Action = "NEW" | "UPDATE" | "NOT_FOUND";

type PreviewRow = IntakeRow & {
  action: Action;
  currentName: string | null;
};

const CLEAN = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\u2060/g, "").trim();

// TEMPORARY diagnostic trace for the Batch Intake date pipeline.
// Remove once the date-shift investigation is closed.
function traceBatch(stage: string, locker: string, value: unknown, extra?: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    stage, locker, raw: value, type: value instanceof Date ? "Date" : typeof value,
  };
  if (value instanceof Date) {
    Object.assign(base, {
      iso: value.toISOString(),
      local: value.toString(),
      getFullYear: value.getFullYear(), getUTCFullYear: value.getUTCFullYear(),
      getMonth: value.getMonth() + 1, getUTCMonth: value.getUTCMonth() + 1,
      getDate: value.getDate(), getUTCDate: value.getUTCDate(),
    });
  }
  // eslint-disable-next-line no-console
  console.log("[batch_intake]", JSON.stringify({ ...base, ...extra, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
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

export function RecordIntakeTab() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [intake, setIntake] = useState<IntakeRow[]>([]);
  const [ignored, setIgnored] = useState<IgnoredRow[]>([]);
  const [dbMap, setDbMap] = useState<Map<string, DbState>>(new Map());
  const [excluded, setExcluded] = useState<Set<string>>(new Set()); // locker_number keys with checkbox UNchecked
  const [showIgnored, setShowIgnored] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ updated: number; skipped: number; errors: number } | null>(null);

  const reset = () => {
    setFile(null); setIntake([]); setIgnored([]); setDbMap(new Map());
    setExcluded(new Set()); setShowIgnored(false); setProgress(null); setResult(null);
  };

  const handleFile = async (f: File) => {
    reset();
    setFile(f);
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const XLSX = await getXLSX();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
      const headerRowIdx = findHeaderRow(aoa);
      if (headerRowIdx < 0) {
        toast.error('Could not find a "Locker Number" header row.');
        setParsing(false);
        return;
      }
      const headers = (aoa[headerRowIdx] ?? []).map((c) => (c == null ? "" : String(c)));
      const cLocker = findCol(headers, /locker\s*number/i);
      const cName = findCol(headers, /employee\s*name/i);
      const cBadge = findCol(headers, /employee\s*number/i);
      const cNid = findCol(headers, /national\s*id/i, /ic\s*number/i);
      const cBatch = findCol(headers, /batch\s*intake/i);
      const cWork = findCol(headers, /work\s*location/i, /work\s*site/i, /location/i);

      const intakeRows: IntakeRow[] = [];
      const ignoredRows: IgnoredRow[] = [];

      for (let i = headerRowIdx + 1; i < aoa.length; i++) {
        const row = aoa[i] ?? [];
        const locker = CLEAN(row[cLocker]);
        const name = cName >= 0 ? CLEAN(row[cName]) : "";
        const badge = cBadge >= 0 ? CLEAN(row[cBadge]) : "";
        const nid = cNid >= 0 ? CLEAN(row[cNid]) : "";
        const work = cWork >= 0 ? CLEAN(row[cWork]) : "";
        const batch = cBatch >= 0 ? row[cBatch] : null;

        // Skip blank rows entirely
        if (!locker && !name && !badge && !nid) continue;

        // Bucket B: no locker number OR purely numeric (row index)
        if (!locker || /^\d+$/.test(locker)) {
          ignoredRows.push({ rowIndex: i + 1, locker_number: locker, employee_name: name, reason: "No locker number" });
          continue;
        }
        // Bucket C: has locker, no employee
        if (!name) {
          ignoredRows.push({ rowIndex: i + 1, locker_number: locker, employee_name: "", reason: "No employee name" });
          continue;
        }
        // Bucket A
        intakeRows.push({
          rowIndex: i + 1,
          locker_number: locker,
          employee_name: name,
          badge_number: badge,
          national_id: nid,
          work_location: work,
          batch_intake: batch,
        });
        // (a) raw cell value from SheetJS + (b) parseBatchIntake result
        traceBatch("a/b: xlsx cell -> parseBatchIntake", locker, batch, { parsed: parseBatchIntake(batch) });
      }

      // Live lookup against DB
      const lockerNums = intakeRows.map((r) => r.locker_number);
      const map = new Map<string, DbState>();
      if (lockerNums.length > 0) {
        // Chunk .in() queries to avoid URL limits
        const CHUNK = 200;
        for (let i = 0; i < lockerNums.length; i += CHUNK) {
          const slice = lockerNums.slice(i, i + CHUNK);
          const { data, error } = await supabase
            .from("lockers")
            .select("locker_number, employee_name, badge_number, national_id, work_location, status")
            .is("deleted_at", null)
            .in("locker_number", slice);
          if (error) {
            toast.error(`DB lookup failed: ${error.message}`);
            break;
          }
          for (const row of data ?? []) {
            map.set(row.locker_number, row as DbState);
          }
        }
      }

      setIntake(intakeRows);
      setIgnored(ignoredRows);
      setDbMap(map);
      toast.success(`Parsed ${intakeRows.length} update row${intakeRows.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
    setParsing(false);
  };

  const previewRows: PreviewRow[] = useMemo(() => {
    return intake.map((r) => {
      const db = dbMap.get(r.locker_number);
      let action: Action;
      let currentName: string | null = null;
      if (!db) action = "NOT_FOUND";
      else if (db.employee_name && db.employee_name.trim()) {
        action = "UPDATE";
        currentName = db.employee_name;
      } else action = "NEW";
      return { ...r, action, currentName };
    });
  }, [intake, dbMap]);

  const counts = useMemo(() => {
    let nu = 0, up = 0, nf = 0;
    for (const r of previewRows) {
      if (r.action === "NEW") nu++;
      else if (r.action === "UPDATE") up++;
      else nf++;
    }
    return { newCount: nu, updateCount: up, notFound: nf };
  }, [previewRows]);

  const toggleExclude = (locker: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(locker)) next.delete(locker);
      else next.add(locker);
      return next;
    });
  };

  const handleApply = async () => {
    const toApply = previewRows.filter(
      (r) => r.action === "NEW" || (r.action === "UPDATE" && !excluded.has(r.locker_number)),
    );
    if (toApply.length === 0) {
      toast.warning("Nothing to apply.");
      return;
    }
    setApplying(true);
    setProgress({ done: 0, total: toApply.length });
    const resume = pauseLockersRealtime();
    let updated = 0, skipped = 0, errors = 0;
    const BATCH = 50;
    try {
      for (let i = 0; i < toApply.length; i += BATCH) {
        const slice = toApply.slice(i, i + BATCH);
        await Promise.all(slice.map(async (r) => {
          const existing = dbMap.get(r.locker_number);
          const batchIso = parseBatchIntake(r.batch_intake);
          traceBatch("c: sending to database", r.locker_number, r.batch_intake, { sending: batchIso });
          const payload = {
            employee_name: r.employee_name,
            badge_number: r.badge_number || existing?.badge_number || null,
            national_id: r.national_id || existing?.national_id || null,
            work_location: r.work_location || existing?.work_location || null,
            status: "active" as const,
            updated_at: new Date().toISOString(),
            ...(batchIso ? { batch_intake: batchIso } : {}),
          };
          const { error, count, data: updatedRows } = await supabase
            .from("lockers")
            .update(payload, { count: "exact" })
            .eq("locker_number", r.locker_number)
            .select()
            .limit(1);
          if (error) errors++;
          else if (count === 0) skipped++;
          else {
            updated++;
            const updatedLocker = updatedRows?.[0];
            traceBatch("d: stored in database", r.locker_number, updatedLocker?.batch_intake ?? null, {
              display: formatBatchIntake(updatedLocker?.batch_intake ?? null),
            });
            if (updatedLocker) {
              try { await syncActivationToOccupancy(updatedLocker); } catch { /* non-fatal */ }
            }
          }
        }));
        setProgress({ done: Math.min(i + BATCH, toApply.length), total: toApply.length });
      }
    } finally {
      resume();
      invalidateLockersCache();
    }
    setResult({ updated, skipped, errors });
    setApplying(false);
    toast.success(`Applied: ${updated} updated, ${skipped} skipped, ${errors} error${errors === 1 ? "" : "s"}.`);
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <Card className="mt-6 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <h2 className="font-display text-xl font-bold">Intake Applied</h2>
        </div>
        <div className="text-sm">
          <span className="text-success font-semibold">{result.updated}</span> lockers updated ·{" "}
          <span className="text-muted-foreground">{result.skipped}</span> skipped (not found) ·{" "}
          <span className={result.errors > 0 ? "text-destructive" : "text-muted-foreground"}>{result.errors}</span> errors
        </div>
        <Button onClick={reset}>Done</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="mt-6 p-6">
        <Label htmlFor="intake-file" className="text-base font-display">Choose intake file</Label>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Excel file containing columns: <code className="bg-muted px-1 rounded">Locker Number</code>,{" "}
          <code className="bg-muted px-1 rounded">Employee Name</code>,{" "}
          <code className="bg-muted px-1 rounded">Employee Number</code>,{" "}
          <code className="bg-muted px-1 rounded">National ID / IC Number</code>,{" "}
          <code className="bg-muted px-1 rounded">Batch intake</code>. Header row is auto-detected.
        </p>
        <div className="flex gap-3 items-center">
          <Input
            id="intake-file"
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="cursor-pointer"
          />
          {parsing && <Badge variant="secondary">Parsing…</Badge>}
          {file && !parsing && <span className="text-xs text-muted-foreground truncate">{file.name}</span>}
        </div>
      </Card>

      {intake.length + ignored.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Preview</h2>
          </div>

          {/* Summary */}
          <div className="text-sm">
            <span className="text-success font-semibold">{intake.length}</span> rows to update ·{" "}
            <span className="text-muted-foreground">{ignored.filter((r) => r.reason === "No locker number").length}</span> rows ignored ·{" "}
            <span className="text-warning font-semibold">{ignored.filter((r) => r.reason === "No employee name").length}</span> rows skipped (no employee)
          </div>

          {/* Records to Update */}
          {previewRows.length > 0 && (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-8"></th>
                    <th className="px-2 py-1.5">Locker #</th>
                    <th className="px-2 py-1.5">Employee Name</th>
                    <th className="px-2 py-1.5">Badge</th>
                    <th className="px-2 py-1.5">National ID</th>
                    <th className="px-2 py-1.5">Work Location</th>
                    <th className="px-2 py-1.5">Batch Intake</th>
                    <th className="px-2 py-1.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => {
                    const checked = r.action === "UPDATE" ? !excluded.has(r.locker_number) : r.action === "NEW";
                    const batchDisplay = (() => {
                      const iso = parseBatchIntake(r.batch_intake);
                      return iso ? formatBatchIntake(iso) : "";
                    })();
                    return (
                      <tr key={`${r.locker_number}-${r.rowIndex}`} className="border-t">
                        <td className="px-2 py-1">
                          {r.action === "UPDATE" ? (
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleExclude(r.locker_number)}
                              aria-label={`Include update for ${r.locker_number}`}
                            />
                          ) : null}
                        </td>
                        <td className="px-2 py-1 font-medium">{r.locker_number}</td>
                        <td className="px-2 py-1">{r.employee_name}</td>
                        <td className="px-2 py-1 text-muted-foreground">{r.badge_number || "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground font-mono text-xs">{maskNationalId(r.national_id) || "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">{r.work_location || "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">{batchDisplay || "—"}</td>
                        <td className="px-2 py-1">
                          {r.action === "NEW" && (
                            <Badge variant="outline" className="border-success text-success">NEW — assign employee</Badge>
                          )}
                          {r.action === "UPDATE" && (
                            <Badge variant="outline" className="border-warning text-warning">
                              UPDATE — replaces {r.currentName}
                            </Badge>
                          )}
                          {r.action === "NOT_FOUND" && (
                            <Badge variant="outline" className="border-destructive text-destructive">NOT FOUND — will skip</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Ignored collapsible */}
          {ignored.length > 0 && (
            <div className="border rounded-md">
              <button
                type="button"
                onClick={() => setShowIgnored((s) => !s)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm font-medium bg-muted/30 hover:bg-muted/50"
              >
                {showIgnored ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {ignored.length} rows will be ignored — click to review
              </button>
              {showIgnored && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20">
                      <tr className="text-left">
                        <th className="px-2 py-1.5">Row #</th>
                        <th className="px-2 py-1.5">Locker #</th>
                        <th className="px-2 py-1.5">Employee Name</th>
                        <th className="px-2 py-1.5">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ignored.map((r) => (
                        <tr key={`ig-${r.rowIndex}`} className="border-t">
                          <td className="px-2 py-1 text-muted-foreground">{r.rowIndex}</td>
                          <td className="px-2 py-1">{r.locker_number || "—"}</td>
                          <td className="px-2 py-1">{r.employee_name || "—"}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {r.reason === "No employee name" && <AlertTriangle className="inline h-3 w-3 text-warning mr-1" />}
                            {r.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Apply */}
          <div className="flex items-center gap-3">
            <Button onClick={handleApply} disabled={applying || (counts.newCount + counts.updateCount === 0)}>
              {applying ? "Applying…" : "Apply Intake Upload"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Will write: {counts.newCount} new + {previewRows.filter((r) => r.action === "UPDATE" && !excluded.has(r.locker_number)).length} updates
              {counts.notFound > 0 ? ` · ${counts.notFound} not found (skipped)` : ""}
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
