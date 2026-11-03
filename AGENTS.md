# Architecture rules

- Keep termination identity matching and display-only history deduplication in `src/lib/termination-history.ts`, with rule tests beside it, so synchronization and history rendering share normalization without coupling delete targets.
- Insert fallback terminated occupancy through the authenticated, security-invoker database RPC with `ON CONFLICT DO NOTHING`; the partial expression index cannot be targeted safely by the browser client's ordinary upsert.
- Keep new-locker validation and empty defaults in `src/lib/add-locker.ts`; derive new unit labels through the canonical category helper without changing existing inventory types.
- Publish locker patches to paginated views for immediate first-page natural-sort insertion; reconcile custom sorts and other page boundaries through the existing server refresh rather than appending out-of-order rows.