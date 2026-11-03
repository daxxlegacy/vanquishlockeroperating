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
- [ ] Verify generated routes and signed-in Admin System section.