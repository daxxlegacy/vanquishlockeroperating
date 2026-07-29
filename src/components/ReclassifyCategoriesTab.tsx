// Reclassify Categories — one-time admin tool. Scans every locker_occupancy
// row, derives the correct category from the locker number pattern, and lets
// an admin review mismatches before applying them.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invalidateOccupancyCache, type OccCategory } from "@/lib/occupancy-cache";
import { deriveOccCategory, OCC_CATEGORY_SHORT } from "@/lib/locker-category";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { downloadCsv } from "@/lib/csv-export";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tags, CheckCircle2, AlertTriangle, Download, Play } from "lucide-react";

type Scanned = {
  id: string;
  locker_number: string;
  current: string;
  correct: OccCategory | null;
};

const label = (c: OccCategory | null) => (c ? OCC_CATEGORY_SHORT[c] : "Unclassified");

export function ReclassifyCategoriesTab() {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<Scanned[] | null>(null);
  const [total, setTotal] = useState(0);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ counts: Record<string, number>; failed: number } | null>(null);

  const mismatches = useMemo(
    () => (scanned ?? []).filter((r) => r.correct !== null && r.correct !== r.current),
    [scanned],
  );
  const unclassified = useMemo(() => (scanned ?? []).filter((r) => r.correct === null), [scanned]);

  const summary = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of mismatches) c[label(m.correct)] = (c[label(m.correct)] ?? 0) + 1;
    return c;
  }, [mismatches]);

  const scan = async () => {
    setScanning(true);
    setScanned(null);
    setResult(null);
    try {
      const rows: Scanned[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("locker_occupancy")
          .select("id, locker_number, category")
          .order("locker_number")
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) {
          rows.push({
            id: r.id,
            locker_number: r.locker_number,
            current: r.category,
            correct: deriveOccCategory(r.locker_number),
          });
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      rows.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
      setTotal(rows.length);
      setScanned(rows);
      toast.success(`Scanned ${rows.length.toLocaleString()} occupancy rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const apply = async () => {
    if (mismatches.length === 0) return;
    setApplying(true);
    setProgress({ done: 0, total: mismatches.length });
    const counts: Record<string, number> = {};
    let failed = 0;
    // Group by target category so we can update in bulk.
    const byTarget = new Map<OccCategory, string[]>();
    for (const m of mismatches) {
      const t = m.correct as OccCategory;
      if (!byTarget.has(t)) byTarget.set(t, []);
      byTarget.get(t)!.push(m.id);
    }
    let done = 0;
    for (const [target, ids] of byTarget) {
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200);
        const { error } = await supabase.from("locker_occupancy").update({ category: target }).in("id", slice);
        if (error) {
          failed += slice.length;
        } else {
          counts[OCC_CATEGORY_SHORT[target]] = (counts[OCC_CATEGORY_SHORT[target]] ?? 0) + slice.length;
        }
        done += slice.length;
        setProgress({ done, total: mismatches.length });
      }
    }
    invalidateOccupancyCache();
    setResult({ counts, failed });
    setApplying(false);
    setScanned(null);
    toast.success(
      failed > 0
        ? `Reclassified ${mismatches.length - failed} rows · ${failed} failed`
        : `Reclassified ${mismatches.length.toLocaleString()} rows`,
    );
  };

  const exportPreview = () => {
    downloadCsv(
      `category-reclassify-${new Date().toISOString().slice(0, 10)}.csv`,
      [...mismatches, ...unclassified].map((r) => ({
        locker_number: r.locker_number,
        current_category: OCC_CATEGORY_SHORT[r.current as OccCategory] ?? r.current,
        correct_category: label(r.correct),
      })),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tags className="h-5 w-5 text-primary" />
        <h2 className="font-display text-xl font-bold">Reclassify Categories</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Derives each occupancy row's category from its locker number — digits+letters = Full,
        1 letter+digits = Shoe, 2–3 letters+digits = Staff, LK01–LK40 = HR. Anything else is
        flagged Unclassified for manual review and is never changed automatically.
      </p>

      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={scan} disabled={scanning || applying}>
            {scanning ? "Scanning…" : "Scan all occupancy rows"}
          </Button>
          {scanned && (
            <>
              <Badge variant="outline">{total.toLocaleString()} rows scanned</Badge>
              <Badge variant={mismatches.length > 0 ? "default" : "secondary"}>
                {mismatches.length.toLocaleString()} mismatched
              </Badge>
              <Badge variant={unclassified.length > 0 ? "destructive" : "secondary"}>
                {unclassified.length.toLocaleString()} unclassified
              </Badge>
              {(mismatches.length > 0 || unclassified.length > 0) && (
                <Button size="sm" variant="outline" onClick={exportPreview}>
                  <Download className="h-4 w-4 mr-1" />Export preview
                </Button>
              )}
            </>
          )}
        </div>

        {scanned && mismatches.length === 0 && unclassified.length === 0 && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Everything is correctly classified</AlertTitle>
            <AlertDescription>No category changes needed.</AlertDescription>
          </Alert>
        )}

        {scanned && (mismatches.length > 0 || unclassified.length > 0) && (
          <>
            <div className="border rounded-md max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0 text-left">
                  <tr>
                    <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Locker Number</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Current Category</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Correct Category</th>
                  </tr>
                </thead>
                <tbody>
                  {[...mismatches, ...unclassified].slice(0, 800).map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{r.locker_number}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {OCC_CATEGORY_SHORT[r.current as OccCategory] ?? r.current}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.correct ? (
                          <Badge variant="outline">{label(r.correct)}</Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />Unclassified
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mismatches.length + unclassified.length > 800 && (
                <div className="p-2 text-xs text-center text-muted-foreground border-t">
                  Showing 800 of {(mismatches.length + unclassified.length).toLocaleString()} — export CSV for the full list
                </div>
              )}
            </div>

            {Object.keys(summary).length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(summary).map(([k, v]) => (
                  <Badge key={k} variant="secondary">{v.toLocaleString()} → {k}</Badge>
                ))}
              </div>
            )}

            {progress && (
              <div className="space-y-1">
                <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
                <p className="text-xs text-muted-foreground">{progress.done} / {progress.total}</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={apply} disabled={applying || mismatches.length === 0}>
                <Play className="h-4 w-4 mr-1" />
                {applying ? "Applying…" : `Apply ${mismatches.length.toLocaleString()} reclassifications`}
              </Button>
            </div>
          </>
        )}

        {result && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Reclassification complete</AlertTitle>
            <AlertDescription>
              {Object.entries(result.counts).map(([k, v]) => `${v} → ${k}`).join(" · ") || "No rows changed"}
              {result.failed > 0 ? ` · ${result.failed} failed` : ""}
            </AlertDescription>
          </Alert>
        )}
      </Card>
    </div>
  );
}
