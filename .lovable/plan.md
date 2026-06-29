## Goal

Make the Occupancy page look and behave like the Lockers page: one single combined table (no Full/Staff/Shoe tabs), include every locker number, add an Excel export, and ensure all flows that affect lockers also update Occupancy.

## Changes

### 1. Combine the 3 category tabs into one view
- Remove the `Full Lockers / Staff Lockers / Shoe Lockers` tabs.
- Single header "Occupancy History" with stat cards: Total Rows, Unique Lockers, Active, Terminated.
- Keep an optional Category filter dropdown (All / Full / Staff / Shoe) so users can still narrow if needed.
- Import Excel button keeps category-specific imports via a small dropdown (Import Full / Staff / Shoe), preserving existing logic.

### 2. Show every locker number (fill the gaps)
- Source the locker list from the `lockers` table (same source as the Lockers page) so every locker number appears.
- Overlay occupancy/termination rows from `locker_occupancy` on top of each locker (matched by `locker_number`).
- Lockers with no occupancy record render as a single row with status from `lockers.status` (vacant/active/etc.) and no history group.
- Existing rows that have occupancy records continue to render as Active + most-recent Terminate.

### 3. Excel export (like Lockers page)
- Add an "Export Excel" button next to "Export CSV", using the same `xlsx` library and styling (bold dark header, auto-width).
- Both exports respect the current filters/search/sort.
- Filename: `LockerOps_occupancy{filterTag}_YYYY-MM-DD.xlsx`.

### 4. Fix synchronization into Occupancy
Audit every place that mutates a locker and confirm it calls the matching `occupancy-sync` helper. Add the missing calls:
- Lockers page Add Locker → call `syncActivationToOccupancy` when the new locker has an occupant.
- Lockers page edit (LockerDetail save) → call `syncMetadataToOccupancy` always; `syncActivationToOccupancy` when becoming active; `syncStatusChangeToOccupancy` when leaving active without a formal termination.
- Swap / Transfer RPCs → after success, sync both source and target lockers.
- Delete locker → remove the locker's occupancy rows.
- Record Intake bulk upload → already calls `syncActivationToOccupancy` (verify).
- Terminate dialog (table + full-page route) → already syncs (verify).

### 5. Visual parity with Lockers page
- Same column order/widths where applicable, same SortHeader + ColumnFilter behaviour, same toolbar layout (search left, dropdowns, missing-NID/Badge toggles where meaningful, export buttons right).
- Keep Reason column and per-locker "View" history dialog (Occupancy-only features).

## Technical notes

- New cache: extend `lib/occupancy-cache.ts` with a combined accessor that returns rows across all 3 categories, plus the `lockers` table merged in. Alternatively, build the merged view in the route via `useOccupancy("main"|"staff"|"shoe")` + `useLockers()` joined client-side.
- A row's "category" still comes from `locker_occupancy.category` when present; otherwise infer from `lockers.location` / naming convention or leave blank.
- xlsx styling reuses the helper pattern already in `src/routes/lockers.tsx` `exportXlsx`.

## Out of scope
- No data migration. Existing occupancy rows stay as-is.
- No DB schema changes.
- No changes to the History dialog logic or the Reason source.

## Question
Should the combined Occupancy view also show a small **Category** column (Full / Staff / Shoe), or keep that hidden and just expose it as a filter?
