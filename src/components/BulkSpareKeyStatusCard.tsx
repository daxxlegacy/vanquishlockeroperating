// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { useRef, useState } from "react";
import { Download, Key, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { readSpareStatusFile } from "@/lib/roster-reader";
import { isCombinationLock } from "@/lib/combination-lock";
import { buildSparePreview, canApplySparePreview, KEY_STATUSES, keyStatusLabel, type SpareFile, type SparePreviewRow } from "@/lib/bulk-spare-key";
import { invalidateLockersCache, patchLockersInCache } from "@/lib/lockers-cache";
import { getXLSX } from "@/lib/xlsx-lazy";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { TablePagination } from "@/components/TablePagination";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];
type Outcome = { id: string; outcome: "updated" | "skipped" | "error"; reason?: string; locker?: Locker };
type Report = { updated: number; skipped: number; errors: number; rows: Record<string, string | number>[] };
async function exportSheet(rows: Record<string, string | number>[], name: string) {
  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Spare Key Status");
  XLSX.writeFile(wb, `${name}.xlsx`);
}
const reportRow = (r: SparePreviewRow) => ({ Sheet: r.sheet, Row: r.row, "Locker Number": r.locker_number, "Current Spare Key Status": keyStatusLabel(r.locker?.spare_key_status ?? null), "New Spare Key Status": r.new_status ?? r.raw_status, Result: r.reason || r.action, Warning: r.warning ?? "" });

export function BulkSpareKeyStatusCard() {
  const { role } = useAuth();
  const [file, setFile] = useState<SpareFile | null>(null);
  const [preview, setPreview] = useState<SparePreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Report | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const changes = preview.filter(r => r.action === "change");
  const problems = preview.filter(r => r.action === "problem" || r.warning);
  const unchanged = preview.filter(r => r.action === "unchanged").length;
  const summary = new Map<string, number>();
  changes.forEach(r => { const label = `${keyStatusLabel(r.locker?.spare_key_status ?? null)} → ${keyStatusLabel(r.new_status)}`; summary.set(label, (summary.get(label) ?? 0) + 1); });
  const reset = (clearInput = true) => { setFile(null); setPreview([]); setResult(null); setConfirmation(""); setPage(1); setProgress(0); if (clearInput && input.current) input.current.value = ""; };

  const read = async (upload: File) => {
    reset(false); setBusy(true);
    try {
      const parsed = await readSpareStatusFile(upload);
      if (!parsed.rows.length) throw new Error(parsed.columns.map(c => `${c.sheet}: ${c.error ?? "No data rows"}`).join("; ") || "No data rows found.");
      // Never apply a partial workbook when an intended sheet cannot be mapped.
      const errors = parsed.columns.filter(c => c.error);
      if (errors.length) throw new Error(errors.map(c => `${c.sheet}: ${c.error}`).join("; "));
      const nums = [...new Set(parsed.rows.map(r => r.locker_number).filter(Boolean))];
      const lockers: Locker[] = [];
      for (let i = 0; i < nums.length; i += 200) {
        const { data, error } = await supabase.from("lockers").select("*").is("deleted_at", null).in("locker_number", nums.slice(i, i + 200));
        if (error) throw error;
        lockers.push(...(data ?? []));
      }
      setFile(parsed); setPreview(buildSparePreview(parsed.rows, lockers));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not read file."); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (role !== "admin" || !canApplySparePreview(changes.length, confirmation) || busy) return;
    setBusy(true); setProgress(0);
    const rows = preview.filter(r => r.action !== "change").map(reportRow);
    let updated = 0, skipped = preview.length - changes.length, errors = 0;
    try {
      for (let i = 0; i < changes.length; i += 500) {
        const batch = changes.slice(i, i + 500);
        const { data: originals, error: lookupError } = await supabase.from("lockers").select("*").in("id", batch.flatMap(r => r.locker ? [r.locker.id] : []));
        if (lookupError) throw lookupError;
        const saved = new Map((originals ?? []).map(l => [l.id, l]));
        const optimistic = batch.flatMap(r => { const l = r.locker ? saved.get(r.locker.id) : undefined; return l && !l.deleted_at && !isCombinationLock(l.key_lock) && l.spare_key_status === r.locker?.spare_key_status && r.new_status ? [{ ...l, spare_key_status: r.new_status }] : []; });
        patchLockersInCache(optimistic);
        try {
          const { data, error } = await supabase.rpc("bulk_spare_key_status", { _changes: batch.flatMap(r => r.locker && r.new_status ? [{ id: r.locker.id, previous_status: r.locker.spare_key_status, new_status: r.new_status }] : []) });
          if (error) throw error;
          const outcomes = data as unknown as Outcome[];
          if (!Array.isArray(outcomes)) throw new Error("No batch result returned.");
          for (const r of batch) {
            const outcome = outcomes.find(o => o.id === r.locker?.id);
            if (outcome?.outcome === "updated" && outcome.locker) { updated++; patchLockersInCache([outcome.locker]); }
            else { const original = r.locker ? saved.get(r.locker.id) : undefined; if (original) patchLockersInCache([original]); if (outcome?.outcome === "skipped") skipped++; else errors++; }
            rows.push({ ...reportRow(r), Result: outcome?.outcome ?? "error", Warning: outcome?.reason ?? r.warning ?? "" });
          }
        } catch (error) {
          patchLockersInCache(originals ?? []); errors += batch.length;
          batch.forEach(r => rows.push({ ...reportRow(r), Result: "error", Warning: error instanceof Error ? error.message : "Batch failed; upload again to verify" }));
        } finally { invalidateLockersCache(); }
        setProgress(Math.min(i + 500, changes.length));
      }
    } catch (error) {
      const pending = changes.slice(progress);
      errors = changes.length - updated - (skipped - (preview.length - changes.length));
      pending.forEach(r => { if (!rows.some(o => o.Sheet === r.sheet && o.Row === r.row)) rows.push({ ...reportRow(r), Result: "error", Warning: error instanceof Error ? error.message : "Could not apply" }); });
    } finally { invalidateLockersCache(); setBusy(false); }
    setResult({ updated, skipped, errors, rows });
  };

  if (role !== "admin") return null;
  return (
    <Card className="p-6 space-y-4" aria-label="Bulk spare key status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-display flex items-center gap-2"><Key className="h-4 w-4" />Bulk spare key status</h2>
          <p className="text-xs text-muted-foreground mt-1">Excel/CSV with two columns: Locker Number and New Spare Key Status. Only the spare key status is updated. Lockers not in the file are not changed. Identity fields are never touched.</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportSheet([{ "Locker Number": "1A", "New Spare Key Status": "Available" }], "bulk-spare-key-template").catch(() => toast.error("Could not download template."))}><Download className="h-4 w-4 mr-1.5" />Download Template</Button>
      </div>
      <Label htmlFor="bulk-spare-key-file">Choose spare key status file</Label>
      <Input ref={input} id="bulk-spare-key-file" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={e => { const upload = e.target.files?.[0]; if (upload) void read(upload); }} />
      <p className="text-xs text-muted-foreground">Valid statuses: {KEY_STATUSES.map(s => `${keyStatusLabel(s)} (${s})`).join(", ")}.</p>
      {busy && !file && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Reading file…</p>}
      {file && !result && <>
        <h3 className="font-display font-semibold">Spare key preview</h3>
        <p className="text-sm">Total rows: {preview.length} · Will change: {changes.length} · Unchanged: {unchanged} · Problem rows: {preview.filter(r => r.action === "problem").length} · Warnings: {preview.filter(r => r.warning).length}</p>
        {file.columns.map(c => <p key={c.sheet} className="text-xs text-muted-foreground">{c.sheet} — header row {c.headerRow}; {c.locker} / {c.status}; {c.rows} rows</p>)}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{[...summary].map(([label, count]) => <span key={label}>{label}: {count}</span>)}</div>
        <div className="border rounded-md overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/40"><tr>{["Locker number", "Location", "Key lock", "Current → New", "Result"].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead><tbody>{preview.slice((page - 1) * 100, page * 100).map(r => <tr key={`${r.sheet}:${r.row}`} className="border-t"><td className="px-3 py-2">{r.locker_number || "—"}</td><td className="px-3 py-2">{r.locker?.location ?? "—"}</td><td className="px-3 py-2">{r.locker?.key_lock ?? "—"}</td><td className="px-3 py-2">{keyStatusLabel(r.locker?.spare_key_status ?? null)} → {r.new_status ? keyStatusLabel(r.new_status) : r.raw_status}</td><td className="px-3 py-2"><span className={r.action === "problem" ? "text-destructive" : "text-muted-foreground"}>{r.reason || "Will change"}</span>{r.warning && <p className="text-warning text-xs">{r.warning}</p>}</td></tr>)}</tbody></table></div>
        <TablePagination page={page} pageSize={100} total={preview.length} onPageChange={setPage} loading={busy} />
        {changes.length > 300 && <div className="border border-destructive bg-destructive/10 p-3 rounded-md space-y-2"><p className="text-destructive text-sm">More than 300 lockers will change. Type CONFIRM to continue.</p><Input aria-label="Confirm spare key changes" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></div>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !canApplySparePreview(changes.length, confirmation)} onClick={() => void apply()}>{busy ? "Applying…" : "Confirm and apply"}</Button><Button variant="outline" disabled={busy} onClick={() => reset()}>Cancel</Button><Button variant="outline" disabled={busy || !problems.length} onClick={() => void exportSheet(problems.map(reportRow), "bulk-spare-key-problems").catch(() => toast.error("Could not export problems."))}><Download className="h-4 w-4 mr-1.5" />Download problem rows</Button></div>
        {busy && <Progress value={100 * progress / Math.max(changes.length, 1)} />}
      </>}
      {result && <><p className="text-sm font-semibold" role="status">Updated {result.updated} lockers, skipped {result.skipped}, errors {result.errors}</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void exportSheet(result.rows, "bulk-spare-key-result").catch(() => toast.error("Could not export result."))}><Download className="h-4 w-4 mr-1.5" />Download result</Button><Button onClick={() => reset()}>Done</Button></div></>}
    </Card>
  );
}