// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { property: "og:title", content: "Reset password — LockerOps" },
      { property: "og:description", content: "Set a new password for your LockerOps account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "Reset password — LockerOps" },
      { name: "description", content: "Set a new password for your LockerOps account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase auto-exchanges the recovery token from the URL hash on load
    // and emits a PASSWORD_RECOVERY event. Allow either an existing session
    // or that event to unlock the form.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated. You're signed in.");
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background p-8">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 font-display font-bold text-xl mb-6">
          <div className="h-9 w-9 rounded-lg bg-primary grid place-items-center">
            <Lock className="h-5 w-5 text-primary-foreground" />
          </div>
          LockerOps
        </div>
        <h1 className="font-display text-2xl font-bold">Set a new password</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {ready
            ? "Enter and confirm your new password below."
            : "Validating your reset link…"}
        </p>

        {ready ? (
          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground mt-6">
            If this link was opened from your email, the form will appear shortly. If nothing happens,
            request a new reset link from the sign-in page.
          </p>
        )}
      </div>
    </div>
  );
}
