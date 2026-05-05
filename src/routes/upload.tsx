import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle2, AlertCircle, UserMinus, UserCheck, Plus, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";
import { parseBatchIntake, formatBatchIntake } from "@/lib/locker-utils";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload Locker Data — LockerOps" },
      { name: "description", content: "Upload locker data file. The system auto-detects columns and syncs records." },
    ],
  }),
  component: UploadPage,
});

interface UploadHistoryRow {
  id: string;
  filename: string | null;
  rows_processed: number | null;
  resigned_count: number | null;
  active_count: number | null;
  created_at: string;
}

type LockerRow = {
  locker_number: string;
  location: string;
  row_label: string | null;
  unit_type: string | null;
  key_lock: string | null;
  badge_number: string | null;
  employee_name: string | null;
  status: "active" | "empty" | "repair" | "cleaning" | "broken_door" | "on_hold" | "reserved" | "unknown";
  physical_key_status: "available" | "missing" | "with_employee" | "damaged" | "unknown";
  spare_key_status: "available" | "missing" | "with_employee" | "damaged" | "unknown";
  remark: string | null;
  batch_intake: string | null;
};

interface PreviewResult {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  activeAfter: number;
  newlyResigned: { locker_number: string; employee_name: string | null; badge_number: string | null }[];
  parsed: LockerRow[];
  detectedColumns: Record<string, string>;
}

function UploadPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [history, setHistory] = useState<UploadHistoryRow[]>([]);

  useEffect(() => {
    if (!loading) {
      if (!user) navigate({ to: "/auth" });
      else if (role && role !== "admin") navigate({ to: "/" });
    }
  }, [user, role, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from("upload_history").select("*").order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => setHistory((data as UploadHistoryRow[]) ?? []));
  }, [user]);

  const handleFile = async (f: File) => {
    setFile(f);
    setPreview(null);
    setParsing(true);
    try {
      const rows = await parseFile(f);
      if (rows.length === 0) {
        toast.error("File is empty.");
        setParsing(false);
        return;
      }

      const detected = detectColumns(Object.keys(rows[0]));
      if (!detected.locker_number) {
        toast.error("Couldn't find a locker column. Expected something like 'Combine Locker' or 'Locker Number'.");
        setParsing(false);
        return;
      }

      const parsed: LockerRow[] = [];
      for (const r of rows) {
        const row = mapRow(r, detected);
        if (row) parsed.push(row);
      }

      // Load existing lockers for diff
      const existing: { id: string; locker_number: string; employee_name: string | null; badge_number: string | null; status: string }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("lockers").select("id, locker_number, employee_name, badge_number, status").range(from, from + 999);
        if (!data || data.length === 0) break;
        existing.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }

      const existingMap = new Map(existing.map((l) => [l.locker_number.trim().toUpperCase(), l]));
      const incomingKeys = new Set(parsed.map((p) => p.locker_number.trim().toUpperCase()));

      let toCreate = 0;
      let toUpdate = 0;
      let activeAfter = 0;
      for (const p of parsed) {
        const k = p.locker_number.trim().toUpperCase();
        if (existingMap.has(k)) toUpdate++;
        else toCreate++;
        if (p.status === "active") activeAfter++;
      }

      // Resigned = currently active in DB but not present in upload
      const resigned: PreviewResult["newlyResigned"] = [];
      for (const l of existing) {
        if (l.status === "active" && !incomingKeys.has(l.locker_number.trim().toUpperCase())) {
          resigned.push({ locker_number: l.locker_number, employee_name: l.employee_name, badge_number: l.badge_number });
        }
      }

      setPreview({
        totalRows: parsed.length,
        toCreate,
        toUpdate,
        activeAfter,
        newlyResigned: resigned,
        parsed,
        detectedColumns: detected,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
    setParsing(false);
  };

  const handleApply = async () => {
    if (!preview || !file || !user) return;
    setApplying(true);
    try {
      // Upsert rows in chunks
      const CHUNK = 200;
      for (let i = 0; i < preview.parsed.length; i += CHUNK) {
        const slice = preview.parsed.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("lockers")
          .upsert(slice, { onConflict: "locker_number" });
        if (error) throw error;
      }

      // Mark resigned lockers (active in DB but missing from upload) as empty
      const resignedKeys = preview.newlyResigned.map((r) => r.locker_number);
      for (let i = 0; i < resignedKeys.length; i += CHUNK) {
        const slice = resignedKeys.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("lockers")
          .update({ status: "empty", employee_name: null, badge_number: null, remark: "Auto-resigned via upload" })
          .in("locker_number", slice);
        if (error) throw error;
      }

      await supabase.from("upload_history").insert({
        uploaded_by: user.id,
        filename: file.name,
        rows_processed: preview.totalRows,
        resigned_count: preview.newlyResigned.length,
        active_count: preview.activeAfter,
      });
      toast.success(`Sync complete — ${preview.toCreate} created, ${preview.toUpdate} updated, ${preview.newlyResigned.length} freed.`);
      setPreview(null);
      setFile(null);
      const { data } = await supabase.from("upload_history").select("*").order("created_at", { ascending: false }).limit(10);
      setHistory((data as UploadHistoryRow[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apply failed");
    }
    setApplying(false);
  };

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="font-display text-3xl font-bold">Upload Locker Data</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Upload your CSV or Excel file. Columns are auto-detected — new lockers are added, existing ones are updated, and active lockers missing from the file are marked as resigned.
        </p>

        <Card className="mt-6 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[260px]">
              <Label htmlFor="file" className="text-base font-display">Choose file</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Recognized columns: <code className="bg-muted px-1 py-0.5 rounded text-xs">Combine Locker</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Locker Location by Row</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Types of Key Lock</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">badge_number</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Vlookup O+C Name</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Status</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Status Available / Not Available</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Physical Key Status</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Remarks</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Batch Intake</code>.
              </p>
              <div className="flex gap-3 items-center">
                <Input id="file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="cursor-pointer" />
                {parsing && <Badge variant="secondary">Parsing…</Badge>}
              </div>
            </div>
            <div className="flex flex-col gap-2 min-w-[180px]">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Export current data</Label>
              <Button variant="outline" size="sm" onClick={() => exportLockers("xlsx")}>
                <Download className="h-4 w-4 mr-1" /> Export as Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportLockers("csv")}>
                <Download className="h-4 w-4 mr-1" /> Export as CSV
              </Button>
            </div>
          </div>
        </Card>

        {preview && (
          <Card className="mt-6 p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Preview: {file?.name}</h2>
            </div>

            <div className="grid md:grid-cols-4 gap-3 mb-4">
              <Stat icon={UploadIcon} label="Rows in file" value={preview.totalRows} />
              <Stat icon={Plus} label="New lockers" value={preview.toCreate} accent="text-success" />
              <Stat icon={RefreshCw} label="Updates" value={preview.toUpdate} accent="text-primary" />
              <Stat icon={UserMinus} label="To resign" value={preview.newlyResigned.length} accent="text-destructive" />
            </div>

            <div className="mb-4 rounded-md border p-3 bg-muted/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Detected column mapping</div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(preview.detectedColumns).map(([k, v]) => (
                  <div key={k}><span className="font-mono text-muted-foreground">{k}</span> ← <span className="font-medium">{v}</span></div>
                ))}
              </div>
            </div>

            {preview.newlyResigned.length > 0 ? (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{preview.newlyResigned.length} active locker(s) will be freed</AlertTitle>
                <AlertDescription>
                  These lockers are active in the system but missing from the upload. They will be set to <strong>empty</strong>.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="mb-4">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>No resignations detected</AlertTitle>
                <AlertDescription>All currently active lockers are present in the upload.</AlertDescription>
              </Alert>
            )}

            {preview.newlyResigned.length > 0 && (
              <div className="border rounded-md max-h-60 overflow-y-auto mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr><Th>Locker</Th><Th>Employee</Th><Th>Badge</Th></tr>
                  </thead>
                  <tbody>
                    {preview.newlyResigned.slice(0, 200).map((r) => (
                      <tr key={r.locker_number} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.locker_number}</td>
                        <td className="px-3 py-2">{r.employee_name ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.badge_number ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.newlyResigned.length > 200 && <div className="p-2 text-xs text-center text-muted-foreground border-t">… and {preview.newlyResigned.length - 200} more</div>}
              </div>
            )}

            <div className="border rounded-md max-h-72 overflow-auto mb-4">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr><Th>Locker</Th><Th>Location</Th><Th>Badge</Th><Th>Name</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {preview.parsed.slice(0, 50).map((p) => (
                    <tr key={p.locker_number} className="border-t">
                      <td className="px-3 py-2 font-medium">{p.locker_number}</td>
                      <td className="px-3 py-2">{p.location}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.badge_number ?? "—"}</td>
                      <td className="px-3 py-2">{p.employee_name ?? "—"}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.parsed.length > 50 && <div className="p-2 text-xs text-center text-muted-foreground border-t">Showing 50 of {preview.parsed.length} rows</div>}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setPreview(null); setFile(null); }}>Cancel</Button>
              <Button onClick={handleApply} disabled={applying}>
                {applying ? "Applying…" : "Apply changes"}
              </Button>
            </div>
          </Card>
        )}

        <Card className="mt-6 p-6">
          <h2 className="font-display text-xl font-bold mb-4">Upload history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No uploads yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr><Th>Date</Th><Th>File</Th><Th>Rows</Th><Th>Active</Th><Th>Resigned</Th></tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="px-3 py-2">{new Date(h.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2">{h.filename}</td>
                      <td className="px-3 py-2">{h.rows_processed}</td>
                      <td className="px-3 py-2 text-success">{h.active_count}</td>
                      <td className="px-3 py-2 text-destructive">{h.resigned_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground text-left">{children}</th>;
}

function Stat({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; accent?: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <Icon className={`h-7 w-7 ${accent ?? "text-muted-foreground"}`} />
      <div>
        <div className="text-2xl font-bold font-display">{value.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

// ---------- helpers ----------
async function parseFile(f: File): Promise<Record<string, unknown>[]> {
  const ext = f.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data as Record<string, unknown>[]),
        error: (err) => reject(err),
      });
    });
  }
  const buf = await f.arrayBuffer();
  // raw:true keeps Excel date serials as numbers so we can parse them as dd/mm/yyyy aware.
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_\-/+()]/g, "");
}

// Maps our internal field → matching column header from the file
function detectColumns(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const aliases: Record<string, string[]> = {
    locker_number: ["combinelocker", "lockernumber", "locker", "lockerno", "lockerid"],
    location: ["lockerlocation", "lockerlocationbyrow", "location"],
    row_label: ["row", "rowlabel", "lockerlocationbyrow"],
    unit_type: ["typesofkeylock", "unittype", "type", "lockertype"],
    key_lock: ["keylock", "typesofkeylock", "lock"],
    badge_number: ["badgenumber", "badge", "badgeno", "badgeid"],
    employee_name: ["vlookupocname", "vlookupocname", "employeename", "name", "fullname", "ocname"],
    status: ["status"],
    physical_key_status: ["physicalkeystatus", "physicalkey", "statusavailablenotavailable", "statusavailable"],
    spare_key_status: ["sparekeystatus", "sparekey"],
    remark: ["remarks", "remark", "notes", "note"],
    batch_intake: ["batchintake", "batch", "intake", "intakedate"],
  };

  for (const [field, opts] of Object.entries(aliases)) {
    for (const h of headers) {
      const n = norm(h);
      if (opts.includes(n)) {
        out[field] = h;
        break;
      }
    }
  }
  return out;
}

function getStr(row: Record<string, unknown>, key: string | undefined): string | null {
  if (!key) return null;
  const v = row[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mapStatus(raw: string | null, hasBadge: boolean): LockerRow["status"] {
  if (!raw) return hasBadge ? "active" : "empty";
  const n = raw.toLowerCase();
  if (n.includes("clean")) return "cleaning";
  if (n.includes("broken") || n.includes("broken door") || n.includes("door")) return "broken_door";
  if (n.includes("on hold") || n.includes("onhold") || n.includes("hold")) return "on_hold";
  if (n.includes("reserve")) return "reserved";
  if (n.includes("repair")) return "repair";
  if (n.includes("empty") || n.includes("vacant") || n.includes("available")) return "empty";
  if (n.includes("active") || n.includes("occupied") || n.includes("listing")) return "active";
  if (n.includes("unknown")) return "unknown";
  return hasBadge ? "active" : "empty";
}

function mapKeyStatus(raw: string | null): LockerRow["physical_key_status"] {
  if (!raw) return "unknown";
  const n = raw.toLowerCase();
  if (n.includes("not available") || n.includes("missing")) return "missing";
  if (n.includes("with employee") || n.includes("withemp")) return "with_employee";
  if (n.includes("damage")) return "damaged";
  if (n.includes("available") || n.includes("ok") || n.includes("yes")) return "available";
  return "unknown";
}

function mapRow(row: Record<string, unknown>, cols: Record<string, string>): LockerRow | null {
  const locker_number = getStr(row, cols.locker_number);
  if (!locker_number) return null;

  const badge_number = getStr(row, cols.badge_number);
  const employee_name = getStr(row, cols.employee_name);
  const statusRaw = getStr(row, cols.status);
  const physRaw = getStr(row, cols.physical_key_status);

  const hasBadge = !!badge_number;
  const status = mapStatus(statusRaw, hasBadge);
  const location = getStr(row, cols.location) ?? "Unassigned";

  return {
    locker_number,
    location,
    row_label: getStr(row, cols.row_label),
    unit_type: getStr(row, cols.unit_type),
    key_lock: getStr(row, cols.key_lock),
    badge_number,
    employee_name,
    status,
    physical_key_status: mapKeyStatus(physRaw),
    spare_key_status: mapKeyStatus(getStr(row, cols.spare_key_status)),
    remark: getStr(row, cols.remark),
    batch_intake: cols.batch_intake ? parseBatchIntake(row[cols.batch_intake]) : null,
  };
}
