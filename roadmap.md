# Add 18 lockers 6796A–6798F
- [x] Preview checked: no target collisions, exact Phase 3 Locker Room exists; 6794/6795 are Parking Manager, so proposed defaults come from all 648 Phase 3 numeric lockers. Visible total 11,472 (11,481 including 9 soft-deleted); location 648. Await confirmation before insertion.
- [x] Revised numeric-lock preview: exact key_lock and unit_type Numeric Lock, row_label Phase 3 Locker Room from closest series 6633. Propose explicit spare_key_status null (existing numeric rows incorrectly retain missing/available; do not copy those). Existing spare query/export/summary and combination-lock warnings exclude numeric locks; missing identity filters count only active lockers. No inserts or existing-row changes.
- [ ] Approved: insert 18 empty unassigned Numeric Lock lockers atomically with null spare-key status, confirmed Phase 3 row label, one admin audit entry, no Occupancy rows, and matching Phase 3 map placement.
- [ ] Publish committed rows to existing caches and verify natural order, map visibility, total 11,490, Phase 3 count +18 and unchanged Spare Keys totals.

# Remove Spare Key sync and Upload History (replacement request)
- [x] Removed the added Spare Keys upload button/dialog and deleted exclusive sync helper/tests; original listing/export unchanged. Shared reader no longer has spare mode; roster parser/header helper retained.
- [x] Upload has exactly the five requested tabs in order and the exact subtitle; no history UI/reads or stale links remain. Roster Sync's upload_history insert, backups, generated types, database records and migrations retained. Tabs are not persisted; stale URLs open Roster Sync.
- [x] Signed-in verification opened all five panels, parsed title-row CSV through the retained roster worker, exported 6,035 Spare Keys rows and confirmed no upload button/history reads/browser errors. Six roster tests pass, changed reader/Upload imports lint clean, latest build OK. Prior isolated test locker 1D is restored to available.

# Spare Key export-compatible sync
- [x] Accept export and legacy headers (including source typo Physicial Key) through shared title-aware multi-sheet worker; show detected columns and legacy last-row-wins duplicate overrides.
- [x] Preview all changes including unlisted-to-missing, require Confirm, apply with previous-status guards, patch returned committed rows and audit spare-key transitions; no Occupancy writes or page/cache modifications.
- [x] Eleven rule tests passed; signed-in original sample detects row 3 on both sheets (2,191 + 97 rows), previews 1,273 changes including 492 unlisted-to-missing without applying. Full export/title-row CSV confirms one isolated change, reads it back, then restores original status; audit rows verified with admin email. Browser errors absent, build OK; logic lint clean excluding repository formatting conventions.

# Roster Check shared reader
- [x] Added shared header-name reader for all sheets/CSV and repeated contractor headers, safe badges, summaries and ephemeral background worker parsing; six new rule tests passed.
- [x] All three cards use the reader; matching priorities/settings and full exports retained, permission-aware ID display/export masking and confirmations preserved, all result tables scrollable with 100 rendered rows.
- [x] Signed-in imports passed for 11,200-row equivalent workbook, all match modes, title-row CSV and specific missing-ID feedback. Both fill downloads verified against existing locker matches without writes; no browser errors, build OK, 12 combined rule tests passed. Original October workbook absent, so exact 11,196-row sample verification remains unavailable.

# Remove Reconcile Duplicates tab
- [x] Remove the tab, content, unused imports, and its exclusive component/export helpers; preserve Occupancy duplicate tools and shared dependencies.
- [x] Audited whole-codebase leftovers: no exclusive external helpers, i18n, links, RPCs or tables; retained historical/generated page_duplicates permission references and all shared dependencies. No database changes.
- [x] Signed-in verification passed: default and stale duplicate URLs open HR Listing; all four remaining tabs and Occupancy duplicate tools open, with live history/reactivation results. Preview build OK, targeted unused-import lint clean, 13 preserved-rule tests passed, no browser errors. Outer tabs were never persisted; HR bucket persistence unchanged.

# Termination type, reason and category
- [x] Added safe multi-layout HR parser, exact reason mapping, warnings, Needs check list, no HR national ID output and local-date defaults; 14 combined rule tests passed.
- [x] Added nullable metadata and exact-only backfill in 0005; extended atomic termination and existing paged occupancy search, role-masked history RPC; 0006 preserves HR OTHER rows with missing type while manual forms require it.
- [x] Updated both termination forms, HR Listing editable reasons/admin-only expanded notes/exports and Occupancy badges/filter/history/masked exports; same-origin in-memory handoff preserves private notes without URLs or persistence.
- [x] Signed-in checks passed for AWOL filtering and second page, OTHER type validation, real HR import, editable reason and new-tab handoff; rollback-only SQL verified metadata, idempotent retry, spare keys, admin/viewer detail masking and failure rollback. Parsed 177 rows from Terminated_List_Fatihah_-_19_May_26.xlsx, zero Needs check; five sanitized samples available. Build OK; no new live test terminations.

# Restore verification test lockers
- [x] Restored 1000A, 1000B, 1000C, 1001A and 1001B in one transaction using equivalent admin snapshot logic; recovered national IDs from the preserved occupancy rows, reactivated those same rows without inserts, and marked all five terminations undone.
- [x] Added one status audit note per locker: Restored after verification testing, under Farid's admin identity. Verified all five saved names/badges/statuses and matching national IDs; signed-in Occupancy shows Active 9,526 and Duplicate Terminated 0 groups, and Admin marks restored history. No browser errors.

# WX locker rename
- [x] Preview 216 lockers and confirm no collisions.
- [x] Rename all 216 lockers and exact linked references atomically, preserving unit_type, categories, dates, and audit mapping.
- [x] Rename 36 map labels without changing positions and refresh all three caches plus saved map layout.
- [x] Verify total 11,472, zero WX, unchanged non-number data, 6103A search/history/key fields, 6108A transfer history, and map compartments in Farid's signed-in session.

# Duplicate termination fix
- [x] Deduplicate termination history cards without changing Active/Transfer/Swap events or delete targets; display reason and admin email.
- [x] Make occupancy termination synchronization idempotent and refresh caches in the correct order.
- [x] Remove identical terminated occupancy duplicates (0 found/removed) and add the unique guard plus conflict-safe insert RPC.
- [x] Run 5 passing rule tests and verify isolated termination from Lockers through Occupancy history; one new terminated occupancy record, one kept card with reason/email, retry unchanged. Existing stat counts one terminated locker per locker number, not every historical row. Test fixture removed; locker total restored to 11,472. Build OK.

# Simplified Add Locker
- [x] Three-field form with validated number, existing location/key dropdowns, and friendly duplicates.
- [x] Empty unassigned insert with derived unit category and immediate naturally sorted first-page update, followed by server reconciliation.
- [x] Nine rule tests passed; signed-in invalid/duplicate/add flow and desktop/mobile dialog verified; test locker removed. Build OK.

# Admin cleanup
- [x] Confirm RunHistoryPanel has no other consumers; remove automation card, state key, run-history block, unused imports, and automation wording.
- [x] Delete both automation redirect routes and the unused run-history panel; leave occupancy synchronization and retained audit panels unchanged.
- [x] Generated route tree contains neither redirect; signed-in Admin shows Termination History and Deletion Audit without automation, stale saved automation state is discarded, no browser errors, and build OK.

# Status log cleanup noise
- [x] Remove status-log writes from duplicate-history and duplicate-occupant cleanup; confirm terminated cleanup RPC logs only deletion audit.
- [x] Hide duplicate-removed entries in the viewer without touching Lockers/Occupancy search, pagination, or caching.
- [x] Deleted 2,262 matching status-log entries; zero remain. Filter rule test passed, signed-in viewer excludes cleanup noise, no browser errors, and build OK. Applied as a one-time data cleanup, not a schema migration.

# Atomic termination
- [x] Capture real before/after records for Lockers 1000A and HR Listing 1000B; both produced one occupancy row, one independent termination, no fallback insert. One unrelated same-name/different-badge history pair exists across lockers.
- [x] Added admin-only atomic RPC and both unique guards in 0004; exact occupancy duplicates removed: 0; existing active termination duplicate groups: 0.
- [x] All four terminateLocker callers use final committed cache state; both dialogs no longer invent patches; HR failures toast per locker; upload failures stop with a toast. No search/pagination changes.
- [x] Verified 1000C single and 1001A/1001B HR bulk, each one occupancy row/termination/history card; simultaneous duplicated requests returned 200/200 with one write. Rollback-only database rule tests passed for normalized multi-category rows, other-person history, spare keys, Undo snapshot, noop retry, fallback, rollback and admin-only access. Seven code tests pass, controlled UI error visible, no browser errors, build OK. Five requested real test terminations retained; Active occupancy 9,526 → 9,521, lockers 11,472 unchanged, duplicate badge groups 0. An unrelated live termination happened during checks, so historical total comparison is not isolated.