// Duplicates view — same functionality as the old /duplicates route,
// now embedded as a tab inside the Reconcile page.
import { useMemo, useState } from "react";
import { LockerDetail } from "@/components/LockerDetail";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, BadgeAlert, Download } from "lucide-react";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { useLockers, invalidateLockersCache } from "@/lib/lockers-cache";
import { useAuth } from "@/lib/auth";
import { getXLSX } from "@/lib/xlsx-lazy";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

function normName(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function DuplicatesSection() {
  const { role } = useAuth();
  const { lockers } = useLockers();
  const [selected, setSelected] = useState<string | null>(null);

  const nameGroups = useMemo(() => {
    if (!lockers) return [];
    const map = new Map<string, Locker[]>();
    for (const l of lockers) {
      const k = normName(l.employee_name);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return Array.from(map.values())
      .filter((g) => g.length > 1)
      .map((g) => g.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number)))
      .sort((a, b) => compareLockerNumbers(a[0].locker_number, b[0].locker_number));
  }, [lockers]);

  const badgeGroups = useMemo(() => {
    if (!lockers) return [];
    const map = new Map<string, Locker[]>();
    for (const l of lockers) {
      const k = (l.badge_number ?? "").trim().toLowerCase();
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return Array.from(map.values())
      .filter((g) => g.length > 1)
      .map((g) => g.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number)))
      .sort((a, b) => compareLockerNumbers(a[0].locker_number, b[0].locker_number));
  }, [lockers]);

  if (!lockers) return <Skeleton className="h-96 w-full" />;

  return (
    <>
      <p className="text-muted-foreground text-sm mb-4">
        Same employee name or badge number on more than one locker. Click a locker to review or fix.
      </p>
      <Tabs defaultValue="names">
        <TabsList>
          <TabsTrigger value="names" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Names ({nameGroups.length})</TabsTrigger>
          <TabsTrigger value="badges" className="gap-1.5"><BadgeAlert className="h-3.5 w-3.5" /> Badges ({badgeGroups.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="names" className="mt-4">
          {role === "admin" && (
            <div className="flex justify-end mb-3">
              <Button size="sm" variant="outline" disabled={nameGroups.length === 0}
                onClick={() => exportDuplicates(nameGroups, "name")}>
                <Download className="h-4 w-4 mr-1.5" /> Export to Excel
              </Button>
            </div>
          )}
          {nameGroups.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">No duplicate names. 🎉</Card>
          ) : (
            <DupList groups={nameGroups} keyLabel="employee_name" onPick={setSelected} />
          )}
        </TabsContent>

        <TabsContent value="badges" className="mt-4">
          {role === "admin" && (
            <div className="flex justify-end mb-3">
              <Button size="sm" variant="outline" disabled={badgeGroups.length === 0}
                onClick={() => exportDuplicates(badgeGroups, "badge")}>
                <Download className="h-4 w-4 mr-1.5" /> Export to Excel
              </Button>
            </div>
          )}
          {badgeGroups.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">No duplicate badges. 🎉</Card>
          ) : (
            <DupList groups={badgeGroups} keyLabel="badge_number" onPick={setSelected} />
          )}
        </TabsContent>
      </Tabs>

      <LockerDetail
        lockerId={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onUpdated={() => { invalidateLockersCache(); }}
      />
    </>
  );
}

function DupList({ groups, keyLabel, onPick }: { groups: Locker[][]; keyLabel: "employee_name" | "badge_number"; onPick: (id: string) => void }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <Card key={g[0].id} className="p-4">
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <span className="font-display font-bold text-lg">
              {keyLabel === "employee_name" ? g[0].employee_name : <span className="font-mono">Badge {g[0].badge_number}</span>}
            </span>
            <Badge variant="destructive">{g.length} lockers</Badge>
            {keyLabel === "badge_number" && (
              <span className="text-sm text-muted-foreground">
                {Array.from(new Set(g.map((l) => l.employee_name).filter(Boolean))).join(", ") || "(no name)"}
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {g.map((l) => (
              <button
                key={l.id}
                onClick={() => onPick(l.id)}
                className="text-left rounded border p-2.5 hover:border-primary hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-semibold">{l.locker_number}</span>
                  <span className="text-xs text-muted-foreground">{l.location}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {keyLabel === "employee_name"
                    ? <>Badge: {l.badge_number ?? "—"} · {l.row_label ?? "—"}</>
                    : <>{l.employee_name ?? "—"} · {l.row_label ?? "—"}</>}
                </div>
              </button>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

async function exportDuplicates(groups: Locker[][], kind: "name" | "badge") {
  if (groups.length === 0) {
    toast.error("Nothing to export");
    return;
  }
  const rows = groups.flatMap((g, i) => {
    const groupId = i + 1;
    const groupKey = kind === "name"
      ? (g[0].employee_name ?? "")
      : (g[0].badge_number ?? "");
    return g.map((l) => ({
      "Group #": groupId,
      "Duplicate Type": kind === "name" ? "Employee Name" : "Badge Number",
      "Duplicate Value": groupKey,
      "Locker Count": g.length,
      "Locker Number": l.locker_number,
      "Location": l.location,
      "Employee Name": l.employee_name ?? "",
      "Badge Number": l.badge_number ?? "",
      "Status": l.status,
      "Key Lock": l.key_lock ?? "",
      "Batch Intake": l.batch_intake ?? "",
      "Remark": l.remark ?? "",
    }));
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0]);
  ws["!cols"] = headers.map((h) => ({
    wch: Math.min(40, Math.max(h.length, ...rows.map((r) => String((r as Record<string, unknown>)[h] ?? "").length))) + 2,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind === "name" ? "Duplicate Names" : "Duplicate Badges");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `duplicate-${kind === "name" ? "names" : "badges"}-${stamp}.xlsx`);
  toast.success(`Exported ${rows.length} rows across ${groups.length} groups`);
}
