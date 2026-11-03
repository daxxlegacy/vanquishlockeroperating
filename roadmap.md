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