import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InviteSchema = z.object({
  email: z.string().trim().email().max(255),
  role: z.enum(["admin", "viewer"]).default("viewer"),
});

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify caller is admin
    const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });

    const redirectTo =
      process.env.SITE_URL ?? "https://vanquishlockeroperating.lovable.app";

    const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      { redirectTo: `${redirectTo}/auth` }
    );

    if (error) {
      // If user already exists, surface a clear message
      throw new Error(error.message);
    }

    const newUserId = invited.user?.id;
    if (!newUserId) throw new Error("Invite succeeded but no user id returned");

    // Ensure profile exists (trigger should create it, but be safe)
    await supabaseAdmin.from("profiles").upsert(
      { id: newUserId, email: data.email },
      { onConflict: "id" }
    );

    // Assign role immediately so they aren't stuck pending
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: insertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: data.role });
    if (insertErr) throw new Error(insertErr.message);

    return { ok: true, userId: newUserId };
  });
