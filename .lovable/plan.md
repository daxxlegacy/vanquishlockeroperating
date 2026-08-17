# Server-side pagination for the big tables

Goal: the Lockers, Occupancy and Spare Keys tables stop downloading the whole table into the browser. Each page fetches only the 100 rows it shows, and asks the database to do the searching, filtering, sorting and counting.

This is a dedicated pass. Below is what changes, what stays, and the two decisions that need your call.

## Two decisions needed

1. **Per-column checkbox filters** (the little funnel icons on each column header of the Lockers table, e.g. tick three specific locations). Those menus list every distinct value in the whole table and only work because all rows are in the browser. With server-side paging they can't stay as-is. Options:
   - Replace with server-driven filter menus: the funnel still opens, but its options come from a distinct-values query per column (my recommendation).
   - Drop the funnels and keep the top-bar filters (search, status, location, key lock) which will all be server-side.

2. **Exports.** Today "Export" writes out exactly the rows currently filtered in the browser. After the change the browser only holds 100 rows. I plan to keep export meaning "everything matching the current filters" by streaming the matching rows from the server in 1,000-row chunks purely for the export, then discarding them. Export stays complete; it just takes a moment on large result sets.

## What changes

**New data layer (`src/lib/lockers-page.ts`)**
- `fetchLockersPage({ page, pageSize = 100, search, statusFilter, locationFilter, keyLockFilter, missingNid, missingBadge, sortColumn, sortDirection })` — one Supabase query against the masked view using `.range()`, `.ilike()` OR-group for search across locker number / employee name / badge number, `.eq()`/`.in()` for dropdowns, `.order()` for sort, `count: "exact"` for the total.
- `fetchLockerFacets()` — small distinct queries for locations, key locks, custom statuses. Cached in memory, refreshed on a long interval.
- `fetchLockerFlagCounts()` — two `head: true` count queries for Missing NID / Missing Badge. Fetched once per filter change, not per render.
- `useLockersPage(params)` hook: debounced (300ms) search, keeps the previous page visible while the next loads, exposes `rows`, `total`, `loading`.
- Small localStorage cache of only the last-viewed page for instant back-navigation.

**Lockers page (`src/routes/lockers.tsx`)**
- Drops the full-array `useMemo` chain (sort, distinct values, quick-filter counts, client filtering).
- Adds pagination controls: `Showing 1–100 of 11,472`, Previous/Next, jump-to-page.
- Keeps react-window over the 100 visible rows.
- Filter/sort state still mirrors to the URL and localStorage as it does now, plus the page number.

**Realtime**
- No more live-patching an unbounded array. The realtime subscription checks whether the changed row id is on the current page; if it is, that page refetches. Otherwise a small "New updates available — refresh" chip appears.

**Occupancy (`src/routes/occupancy.tsx`)**
- Same treatment per category tab (`main` / `staff` / `shoe` / `hr`) via a paginated `occupancy-page.ts`, 100 rows per page, server-side search and filters, server-side counts for the tab badges.

**Spare Keys (`src/routes/spare-keys.tsx`)**
- Paginated the same way. Its "exclude numeric locks" rule and the four status summary counts move into the query (`not.ilike` on key lock, plus `head: true` counts) instead of scanning the array.

**Terminations / Transfer & Swap history**
- Already query the database directly and are naturally bounded; they get a page-size cap and Previous/Next only if they're currently unbounded.

## What deliberately stays on the full cache

These are not list views — they compare the whole dataset and would be wrong with only 100 rows:

- Reconcile (HR listing diffing, duplicates detection)
- Bulk Status Update, Record Intake, Upload
- Dashboard summary counts on `/`
- Swap / Transfer dialogs' locker pickers (these move to a server-side "search as you type" lookup instead, since a full load just to pick one locker is the same problem in miniature)

`lockers-cache.ts` therefore keeps `fetchAll`, but it is only loaded on demand by those screens rather than eagerly for every visitor in `__root.tsx`. The full-dataset localStorage cache is removed either way — it is the largest part of the current cost.

**Untouched:** `LockerDetail`, Terminate, Swap, Transfer, and the instant-update patch helpers (`patchLockersInCache`, `removeLockerFromCache`, `patchOccupancyInCache`) all keep working; they operate on single rows and the paginated layer exposes the same patch entry points.

## Database work

Indexes to support the new query shapes, so paging stays fast at 12k+ rows and beyond:
- `lockers`: `(location)`, `(status)`, `(key_lock)`, `(deleted_at)`, plus trigram indexes on `locker_number`, `employee_name`, `badge_number` for the search.
- `locker_occupancy`: `(category, locker_number)`, plus trigram on the searched text columns.
