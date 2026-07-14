// Lazy-loaded SheetJS. Import handlers call `await getXLSX()` so the
// ~1 MB library only downloads when a user actually imports or exports.
let promise: Promise<typeof import("xlsx")> | null = null;
export function getXLSX(): Promise<typeof import("xlsx")> {
  if (!promise) promise = import("xlsx");
  return promise;
}
