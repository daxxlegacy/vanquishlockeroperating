## Goal

1. Let users type any custom status (free-form) on a locker. It propagates everywhere status is shown, filtered, and exported.
2. Audit every page so terminate clears occupant fields but keeps location + key lock type, and every export matches exactly what's visible on screen.

## 1. Custom status — data model

Keep the existing `locker_status` enum (active, empty, cleaning, repair, etc.) so DB functions like `transfer_locker` keep working. Add a new free-form field:

- Migration: `ALTER TABLE public.lockers ADD COLUMN custom_status TEXT;`
- Rule: when `custom_status` is non-empty, the locker's effective status = that text (e.g. "Blocked", "Quarantine", "VIP hold"). When null/empty, fall back to the enum `status`.
- Underlying enum will be set to `repair` (closest "not available" bucket) whenever a custom status is applied, so transfer/swap guards still treat it as unavailable.

## 2. UI changes

**Status edit control** (locker detail, edit dialogs):
- Dropdown: Active, Empty, Cleaning, Repair, **+ Custom…**
- Picking "Custom…" reveals a text input + recent-customs suggestions (pulled live from `SELECT DISTINCT custom_status` so anything you've typed before auto-appears across pages).
- Saving writes `custom_status` + sets enum to `repair`; clearing it back to a standard status nulls `custom_status`.

**Display** (`StatusBadge`):
- If `custom_status` set → render that text in a neutral "custom" badge tone.
- Otherwise render enum as today.
- All status filters (Lockers page, Map, Occupancy, Reconcile, Duplicates, Spare Keys) get the union of standard + every distinct custom_status currently in use.

## 3. Termination audit + fix

Verify across every termination entry point that the result is: occupant cleared, **location + key lock type retained**, status set per chosen action, spare-key auto-rules applied.

Pages/components checked & fixed if needed:
- `TerminateUserDialog` (single)
- `routes/terminate.$lockerId.tsx` (full page)
- `routes/reconcile.tsx` "Terminate all" bulk action
- `components/operations/TerminationsPanel.tsx`
- `lib/termination-actions.ts` (shared writer)

Concrete fields cleared: `employee_name, badge_number, national_id, work_location, batch_intake, remark`. Kept: locker number, location/zone, `key_lock_type`, compartment metadata. Auto-rules kept: round/pull → spare_key=missing; numerical → spare_key=reset.

**Note on `work_location`**: currently cleared on terminate. Confirm — should `work_location` be kept too (since you said "except location and key lock")? Default assumption in this plan: keep `work_location`. Tell me if you want it cleared.

## 4. Export audit + fix

For each page with an Export button, route export through the same filtered/sorted in-memory array the table renders, instead of re-querying. Columns in CSV = columns visible on the page (plus `custom_status`).

Pages checked: Lockers, Spare Keys, Occupancy, Duplicates, Reconcile, Terminations, Audit, Operations history.

Shared helper `src/lib/csv-export.ts` will get a `exportRows(rows, columns)` signature so every page calls it with the exact rendered slice.

## 5. Stability check

After edits I'll run typecheck + a Playwright smoke pass on: set custom status → see it on Lockers list, Map, Occupancy filter, export CSV; terminate one locker → confirm cleared fields + retained location/key; bulk terminate from Reconcile → confirm it hits locker rows.

## Open question (please confirm before I build)

Should `work_location` be **kept** on terminate (matches your "except location and key lock" wording) or **cleared** (current behavior)?
