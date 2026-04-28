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
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle2, AlertCircle, UserMinus, UserCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload Active Employees — LockerOps" },
      { name: "description", content: "Upload active employee file. The system flags missing badges as resigned." },
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

interface PreviewResult {
  totalUploaded: number;
  matchedActive: number;
  newlyResigned: { locker_number: string; employee_name: string | null; badge_number: string | null }[];
}

function UploadPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [activeBadges, setActiveBadges] = useState<Set<string> | null>(null);
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
    setActiveBadges(null);
    setParsing(true);
    try {
      const rows = await parseFile(f);
      const badges = extractBadges(rows);
      if (badges.size === 0) {
        toast.error("No badge numbers detected. Make sure your file has a column named 'badge', 'badge_number', or 'badge no'.");
        setParsing(false);
        return;
      }

      // Compare with current DB
      const all: { id: string; locker_number: string; employee_name: string | null; badge_number: string | null; status: string }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("lockers").select("id, locker_number, employee_name, badge_number, status").range(from, from + 999);
        if (!data) break;
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }

      let matched = 0;
      const resigned: PreviewResult["newlyResigned"] = [];
      for (const l of all) {
        if (l.status === "active" && l.badge_number) {
          if (badges.has(normBadge(l.badge_number))) matched++;
          else resigned.push({ locker_number: l.locker_number, employee_name: l.employee_name, badge_number: l.badge_number });
        }
      }
      setActiveBadges(badges);
      setPreview({ totalUploaded: badges.size, matchedActive: matched, newlyResigned: resigned });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
    setParsing(false);
  };

  const handleApply = async () => {
    if (!preview || !activeBadges || !file || !user) return;
    setApplying(true);
    try {
      // Mark resigned lockers as empty + clear employee data
      const badgesToEmpty = preview.newlyResigned.map((r) => r.locker_number);
      if (badgesToEmpty.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < badgesToEmpty.length; i += CHUNK) {
          const slice = badgesToEmpty.slice(i, i + CHUNK);
          const { error } = await supabase
            .from("lockers")
            .update({ status: "empty", employee_name: null, badge_number: null, remark: "Auto-resigned via upload" })
            .in("locker_number", slice);
          if (error) throw error;
        }
      }
      await supabase.from("upload_history").insert({
        uploaded_by: user.id,
        filename: file.name,
        rows_processed: preview.totalUploaded,
        resigned_count: preview.newlyResigned.length,
        active_count: preview.matchedActive,
      });
      toast.success(`Sync complete — ${preview.newlyResigned.length} lockers freed.`);
      setPreview(null);
      setFile(null);
      setActiveBadges(null);
      // Refresh history
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
        <h1 className="font-display text-3xl font-bold">Upload Active Employees</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Upload a CSV or Excel file of currently active employees. Any locker assigned to a badge that is <strong>not</strong> in the file will be marked as resigned and freed.
        </p>

        <Card className="mt-6 p-6">
          <Label htmlFor="file" className="text-base font-display">Choose file</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Required column: <code className="bg-muted px-1 py-0.5 rounded">badge_number</code> (also accepts <code className="bg-muted px-1 py-0.5 rounded">badge</code> or <code className="bg-muted px-1 py-0.5 rounded">badge no</code>). Format: .csv, .xlsx, .xls
          </p>
          <div className="flex gap-3 items-center">
            <Input id="file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="cursor-pointer" />
            {parsing && <Badge variant="secondary">Parsing…</Badge>}
          </div>
        </Card>

        {preview && (
          <Card className="mt-6 p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Preview: {file?.name}</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-3 mb-6">
              <Stat icon={UploadIcon} label="Badges in file" value={preview.totalUploaded} />
              <Stat icon={UserCheck} label="Still active (matched)" value={preview.matchedActive} accent="text-success" />
              <Stat icon={UserMinus} label="To mark as resigned" value={preview.newlyResigned.length} accent="text-destructive" />
            </div>

            {preview.newlyResigned.length > 0 ? (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{preview.newlyResigned.length} locker(s) will be freed</AlertTitle>
                <AlertDescription>
                  These employees are no longer in the active list. Their lockers will be set to <strong>empty</strong>.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="mb-4">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>All current active lockers match the file</AlertTitle>
                <AlertDescription>No resignations detected.</AlertDescription>
              </Alert>
            )}

            {preview.newlyResigned.length > 0 && (
              <div className="border rounded-md max-h-72 overflow-y-auto mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr><Th>Locker</Th><Th>Employee</Th><Th>Badge</Th></tr>
                  </thead>
                  <tbody>
                    {preview.newlyResigned.slice(0, 200).map((r) => (
                      <tr key={r.locker_number} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.locker_number}</td>
                        <td className="px-3 py-2">{r.employee_name ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.badge_number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.newlyResigned.length > 200 && <div className="p-2 text-xs text-center text-muted-foreground border-t">… and {preview.newlyResigned.length - 200} more</div>}
              </div>
            )}

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
  return <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{children}</th>;
}

function Stat({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; accent?: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <Icon className={`h-8 w-8 ${accent ?? "text-muted-foreground"}`} />
      <div>
        <div className="text-2xl font-bold font-display">{value.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

// ---------- helpers ----------
function normBadge(b: string): string {
  return b.trim().toUpperCase();
}

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
  // xlsx / xls
  const buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function extractBadges(rows: Record<string, unknown>[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    // Find badge column flexibly
    let val: unknown;
    for (const k of Object.keys(row)) {
      const key = k.toLowerCase().replace(/[\s_-]/g, "");
      if (key === "badge" || key === "badgenumber" || key === "badgeno" || key === "badgeid") {
        val = row[k];
        break;
      }
    }
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      out.add(normBadge(String(val)));
    }
  }
  return out;
}
