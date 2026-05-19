// Full backup + restore server functions (admin-only).
// "Data" = operational locker tables. "System" = users/roles/permissions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DATA_TABLES = [
  "lockers",
  "locker_occupancy",
  "terminations",
  "automation_runs",
  "automation_run_items",
  "deletion_audit",
  "upload_history",
] as const;

const SYSTEM_TABLES = ["profiles", "user_roles", "user_permissions"] as const;

type BackupKind = "data" | "system" | "full";

async function assertAdmin(userId: string) {
  const { data: isAdmin, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Response("Forbidden", { status: 403 });
}

async function dumpTables(tables: readonly string[]) {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows: unknown[] = [];
    let from = 0;
    const PAGE = 1000;
    // paginate to avoid 1000-row default cap
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabaseAdmin.from(t).select("*").range(from, from + PAGE - 1);
      if (error) throw new Error(`${t}: ${error.message}`);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    out[t] = rows;
  }
  return out;
}

export const createBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ kind: z.enum(["data", "system", "full"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const kind = data.kind as BackupKind;
    const tables =
      kind === "data" ? DATA_TABLES : kind === "system" ? SYSTEM_TABLES : [...SYSTEM_TABLES, ...DATA_TABLES];
    const payload = await dumpTables(tables);
    return {
      kind,
      version: 1,
      generatedAt: new Date().toISOString(),
      tables: payload,
    };
  });

async function restoreTables(payload: Record<string, unknown[]>, tables: readonly string[]) {
  const report: Record<string, number> = {};
  // Restore in given order so FK-like dependencies (profiles before roles) work.
  for (const t of tables) {
    const rows = payload[t];
    if (!Array.isArray(rows) || rows.length === 0) {
      report[t] = 0;
      continue;
    }
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await supabaseAdmin.from(t).upsert(slice as never, { onConflict: "id" });
      if (error) throw new Error(`${t}: ${error.message}`);
      inserted += slice.length;
    }
    report[t] = inserted;
  }
  return report;
}

export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["data", "system", "full"]),
        tables: z.record(z.string(), z.array(z.any())),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const kind = data.kind as BackupKind;
    const order =
      kind === "data" ? DATA_TABLES : kind === "system" ? SYSTEM_TABLES : [...SYSTEM_TABLES, ...DATA_TABLES];
    const report = await restoreTables(data.tables as Record<string, unknown[]>, order);
    return { ok: true, kind, report };
  });
