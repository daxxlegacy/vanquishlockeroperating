# Architecture rules

- Keep termination identity matching and display-only history deduplication in `src/lib/termination-history.ts`, with rule tests beside it, so synchronization and history rendering share normalization without coupling delete targets.
- Insert fallback terminated occupancy through the authenticated, security-invoker database RPC with `ON CONFLICT DO NOTHING`; the partial expression index cannot be targeted safely by the browser client's ordinary upsert.
- Route every formal termination through the admin-only `terminate_locker_atomic` RPC and publish its committed result through `termination-result.ts`; locking and database guards prevent browser races, and cache refreshes must never invent a cleared locker from stale caller data.
- Keep new-locker validation and empty defaults in `src/lib/add-locker.ts`; derive new unit labels through the canonical category helper without changing existing inventory types.
- Publish locker patches to paginated views for immediate first-page natural-sort insertion; reconcile custom sorts and other page boundaries through the existing server refresh rather than appending out-of-order rows.
- Use the shared combination-lock predicate and KeyBadge for numeric-lock spare-key detail display so null statuses remain N/A rather than missing or unknown.
- Treat the saved current map layout as authoritative for targeted placement corrections and mirror only the affected default sheet; preserve other locations and report placeholder-count discrepancies instead of inventing units.
- Keep reconciliation reachable through its canonical `/reconcile` route with HR Listing as its unpersisted default and duplicate checks only on Occupancy; Admin's System section retains termination history and deletion audits without a separate automation rollback panel.
- Keep the Status Change Log's duplicate-noise predicate in `src/lib/status-change-log.ts` with its rule test; apply it alongside the server query filter so returned cleanup noise cannot render.
- Keep HR header-layout parsing and termination reason normalization in dedicated tested helpers; parsed HR data excludes national IDs, and private detail notes are stripped before Reconcile persistence.
- Keep termination detail access behind the admin-only base table and role-masked history RPC; occupancy stores only coded reason/type/category and preserves the existing server pagination pipeline.
- Hand off HR termination metadata to new termination tabs through source-checked, same-origin messages only; private free text must never enter URLs or browser persistence.
- Keep Upload's three roster tools on one ephemeral Web Worker reader with per-sheet/header-block name mapping and tested normalization; background parsing avoids blocking the page and national IDs remain transient with permission-aware export masking.
- Upload retains only roster sync/check, intake, bulk status and category reclassification; its ephemeral reader serves roster tools only, while legacy upload-history writes stay separate from presentation to preserve audit data without showing a history tab.
- Mount the copyright footer once after the root outlet and select its visibility from route and existing auth state; normal document flow preserves page layouts and leaf robots metadata avoids hiding public QR pages.
