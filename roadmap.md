# WX locker rename
- [x] Preview 216 lockers and confirm no collisions.
- [x] Rename all 216 lockers and exact linked references atomically, preserving unit_type, categories, dates, and audit mapping.
- [x] Rename 36 map labels without changing positions and refresh all three caches plus saved map layout.
- [x] Verify total 11,472, zero WX, unchanged non-number data, 6103A search/history/key fields, 6108A transfer history, and map compartments in Farid's signed-in session.

# Duplicate termination fix
- [ ] Deduplicate termination history cards without changing Active/Transfer/Swap events or delete targets.
- [ ] Make occupancy termination synchronization idempotent and refresh caches in the correct order.
- [ ] Remove identical terminated occupancy duplicates (keep newest) and add the unique guard.
- [ ] Run rule tests and verify one isolated termination from Lockers through Occupancy history and count.