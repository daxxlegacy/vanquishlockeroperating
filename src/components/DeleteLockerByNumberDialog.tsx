import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { softDeleteLocker, undoDeletion, UNDO_TOAST_MS } from "@/lib/delete-actions";
import { removeLockerFromCache, invalidateLockersCache } from "@/lib/lockers-cache";

type Match = { id: string; locker_number: string; location: string };

export function DeleteLockerByNumberDialog({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setMatches(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("lockers")
        .select("id, locker_number, location")
        .ilike("locker_number", `%${query.trim()}%`)
        .is("deleted_at", null)
        .order("locker_number")
        .limit(20);
      if (!cancelled) setMatches((data ?? []) as Match[]);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const reset = () => { setQuery(""); setMatches(null); setSelected(null); setReason(""); setConfirm(""); };

  const reasonOk = reason.trim().length >= 4;
  const confirmOk = !!selected && confirm.trim().toUpperCase() === selected.locker_number.toUpperCase();
  const canDelete = useMemo(() => !!selected && reasonOk && confirmOk && !busy, [selected, reasonOk, confirmOk, busy]);

  const handleDelete = async () => {
    if (!canDelete || !selected) return;
    setBusy(true);
    try {
      const { auditId } = await softDeleteLocker({
        id: selected.id,
        locker_number: selected.locker_number,
        location: selected.location,
        reason: reason.trim(),
      });
      removeLockerFromCache(selected.id);
      invalidateLockersCache();
      toast.success(`Locker ${selected.locker_number} deleted`, {
        description: "You have 15 minutes to undo from Admin → System → Deletion Audit.",
        duration: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          onClick: async () => {
            try { await undoDeletion(auditId); invalidateLockersCache(); toast.success(`Restored ${selected.locker_number}`); onDeleted(); }
            catch (e) { toast.error(e instanceof Error ? e.message : "Undo failed"); }
          },
        },
      });
      setOpen(false); reset(); onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); if (!v) reset(); } }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Trash2 className="h-4 w-4 mr-1" /> Delete Locker
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Delete a locker by number
          </DialogTitle>
          <DialogDescription>
            Search the locker number, pick the exact match, then confirm. Restorable for 15 minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="del-search">Locker number</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="del-search"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null); setConfirm(""); }}
                placeholder="e.g. 1A, A01, LK01"
                className="pl-9 font-mono"
                autoFocus
              />
            </div>
          </div>

          {matches !== null && (
            <div className="border rounded-md max-h-48 overflow-y-auto">
              {matches.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">No active lockers found.</p>
              ) : matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setSelected(m); setConfirm(""); }}
                  className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted/50 ${selected?.id === m.id ? "bg-primary/10" : ""}`}
                >
                  <span className="font-mono font-semibold">{m.locker_number}</span>
                  <span className="text-muted-foreground ml-2">· {m.location}</span>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <>
              <div>
                <Label htmlFor="del-reason">Reason for deletion *</Label>
                <Textarea id="del-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))}
                  placeholder="e.g. Locker physically removed." />
                <p className="text-xs text-muted-foreground mt-1">{reason.trim().length}/500 — min 4 chars</p>
              </div>
              <div>
                <Label htmlFor="del-confirm">Type <span className="font-mono font-semibold">{selected.locker_number}</span> to confirm</Label>
                <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="font-mono" autoComplete="off" />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={!canDelete} onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            {busy ? "Deleting…" : selected ? `Delete ${selected.locker_number}` : "Delete locker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
