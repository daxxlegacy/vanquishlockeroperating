/** Shared title-aware header detection for ephemeral upload readers. */
export const headerToken = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export function findHeaderRow(cells: unknown[][], isHeader: (row: unknown[]) => boolean) {
  return cells.slice(0, 30).findIndex(isHeader);
}