// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  label?: string;
};

export function TablePagination({ page, pageSize, total, loading, onPageChange, label = "rows" }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const [jump, setJump] = useState(String(page));

  useEffect(() => { setJump(String(page)); }, [page]);

  const go = (p: number) => onPageChange(Math.min(pageCount, Math.max(1, p)));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>
          Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {label}
        </span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => go(page - 1)}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Previous
        </Button>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => { e.preventDefault(); const n = Number(jump); if (Number.isFinite(n)) go(n); }}
        >
          <Input
            className="h-8 w-16 text-center"
            value={jump}
            inputMode="numeric"
            aria-label="Page number"
            onChange={(e) => setJump(e.target.value)}
          />
          <span className="text-muted-foreground">/ {pageCount.toLocaleString()}</span>
        </form>
        <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => go(page + 1)}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
