import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CreateUserSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "viewer"]).default("viewer"),
});

const DeleteUserSchema = z.object({
  userId: z.string().uuid(),
});

async function assertAdmin(userId: string) {
  const { data: isAdmin, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Response("Forbidden", { status: 403 });
}

export const createUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: data.fullName ? { full_name: data.fullName } : undefined,
    });
    if (error) throw new Error(error.message);

    const newUserId = created.user?.id;
    if (!newUserId) throw new Error("User created but no id returned");

    await supabaseAdmin.from("profiles").upsert(
      { id: newUserId, email: data.email, full_name: data.fullName ?? null },
      { onConflict: "id" }
    );

    await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: insertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: data.role });
    if (insertErr) throw new Error(insertErr.message);

    return { ok: true, userId: newUserId };
  });

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account");
    }

    // Clean up related rows first (no FK cascade to auth.users in this schema)
    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
