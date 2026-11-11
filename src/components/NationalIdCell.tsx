// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Renders a masked National ID with an optional Reveal button (eye icon)
// that only appears for users with admin or `view_national_id` permission.
// The revealed value automatically re-masks after 10 seconds.
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  maskNationalId,
  isMaskedNationalId,
  useCanRevealNationalId,
  useRevealNationalId,
  type NidTable,
} from "@/lib/national-id";

interface Props {
  value: string | null | undefined;
  recordId: string | null | undefined;
  table: NidTable;
  className?: string;
  emptyLabel?: string;
}

const REVEAL_MS = 10_000;

export function NationalIdCell({ value, recordId, table, className, emptyLabel = "—" }: Props) {
  const canReveal = useCanRevealNationalId();
  const reveal = useRevealNationalId();
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!value || String(value).trim() === "") {
    return <span className={className}>{emptyLabel}</span>;
  }

  // Non-privileged viewers see fully starred output (no last-4 digits).
  const baseMasked = isMaskedNationalId(value) ? value : maskNationalId(value);
  const fullyStarred = "*".repeat(Math.max(baseMasked.length, 10));
  const displayed = revealed ?? (canReveal ? baseMasked : fullyStarred);

  const handleReveal = async () => {
    if (!recordId) return;
    setBusy(true);
    try {
      const full = await reveal(recordId, table);
      if (!full) { toast.error("National ID not found"); return; }
      setRevealed(full);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setRevealed(null), REVEAL_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to reveal";
      toast.error(msg.includes("rate limit") ? "Too many reveals — try again in a few minutes." : msg);
    } finally {
      setBusy(false);
    }
  };

  const handleHide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRevealed(null);
  };

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <span className="font-mono text-xs">{displayed}</span>
      {canReveal && recordId && (
        revealed ? (
          <button
            type="button"
            aria-label="Hide National ID"
            title="Hide"
            onClick={handleHide}
            className="text-muted-foreground hover:text-foreground p-0.5"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Reveal National ID"
            title="Reveal National ID (logged)"
            onClick={handleReveal}
            disabled={busy}
            className="text-muted-foreground hover:text-primary p-0.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )
      )}
    </span>
  );
}
