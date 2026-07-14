## Goal
Cut initial JS payload across every page. Two levers matter here — TanStack Router auto code-splitting is already active (route components are not exported), so the real wins are (a) lazy-loading `xlsx` (SheetJS is the single largest dependency and is currently imported at module scope in 11 files) and (b) a shell-level prefetch + skeleton pending UI.

## Findings from audit

- **Route splitting**: `autoCodeSplitting` is on by default in `@lovable.dev/vite-tanstack-config`. Every route file already keeps its component un-exported, so per-route component chunks are already produced. No `.lazy.tsx` split needed — that would only be marginal noise. Confirmed by grepping every `src/routes/*.tsx`.
- **`recharts`**: only imported by `src/components/ui/chart.tsx`, which no component in the app imports. It is already tree-shaken out. No change needed.
- **`xlsx`**: statically imported in 11 files — `routes/lockers.tsx`, `routes/occupancy.tsx`, `routes/reconcile.tsx`, `routes/spare-keys.tsx`, `routes/upload.tsx`, `components/BulkStatusUpdateTab.tsx`, `components/RecordIntakeTab.tsx`, `components/operations/AutomationPanel.tsx`, `components/operations/DeletionsPanel.tsx`, `components/reconcile/DuplicatesSection.tsx`, `lib/map-layout.ts`. This is the biggest fix.
- **No PDF, QR, or date-picker heavy libs found** at module scope.
- **Virtualization**: lockers/occupancy already use `react-window`. Terminations panel uses a normal table but is bounded (limit 200); leave as-is unless it grows.
- **Column selection**: lockers-cache / occupancy-cache already select `*` from views; changing this is a data-layer refactor outside the scope of a bundling pass, so I'll leave it. Full-detail fetch already happens only in edit dialogs.

## Changes

1. **Add `src/lib/xlsx-lazy.ts`** — one helper exporting `getXLSX(): Promise<typeof import("xlsx")>` with a module-scope memoised promise so the chunk downloads once.
2. **Rewrite each of the 11 files** to remove `import * as XLSX from "xlsx"` and instead `const XLSX = await getXLSX()` inside each handler (upload parse, export, template download). Keeps every existing behaviour; the click-to-download path adds one microtask before the first file open on a given session.
3. **Route pending UI**: register a `defaultPendingComponent` in `src/router.tsx` that renders a lightweight `<Skeleton>`-based shell so first-visit to a lazy chunk shows structure instead of a blank screen.
4. **Shell prefetch**: in `src/routes/__root.tsx` (after auth resolves), fire `prefetchLockers()` and `prefetchOccupancy()` once. Both are already implemented and no-op if warm.
5. **Do not touch**: RLS, business logic, route paths, cache column selection, `terminations` table structure.

## Technical notes

- `xlsx` writeFile paths (`XLSX.writeFile`) all live inside click/submit handlers already — they become `async` (most already are). No React render paths call `xlsx`.
- `src/lib/map-layout.ts` has one xlsx read function; converting its inner function to async is safe since only upload paths call it.
- `prefetchLockers` / `prefetchOccupancy` are best-effort, guarded, and idempotent — safe to call unconditionally on root mount for signed-in users.

## Verification
- Run production build; capture chunk sizes before/after with `du -b dist/**/*.js | sort -n | tail`. Confirm `xlsx` no longer appears in the initial `_root`/`index` chunk and lives in its own on-demand chunk.
- Load `/find-locker` in a fresh session and confirm no xlsx chunk in the network trace.

## Out of scope
- Column-narrowing in lockers/occupancy caches (data-layer, needs its own pass).
- `.lazy.tsx` split files (auto-splitting already gives us this).
- Recharts (already tree-shaken).