export function visibleStatusChangeRows<T extends { new_status: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.new_status !== "(duplicate removed)");
}