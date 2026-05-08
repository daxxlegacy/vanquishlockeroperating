import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/change-password")({
  head: () => ({ meta: [{ title: "Change Password — LockerOps" }] }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && !user) {
    navigate({ to: "/auth" });
    return null;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (pw !== confirm) { toast.error("Passwords do not match"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated");
    setPw(""); setConfirm("");
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-md mx-auto px-6 py-10">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl font-bold">Change password</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Update the temporary password your admin gave you.
        </p>
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">New password</label>
              <Input type="password" required minLength={8}
                     value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Confirm new password</label>
              <Input type="password" required minLength={8}
                     value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
