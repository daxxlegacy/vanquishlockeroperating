import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Sign in — LockerOps" }, { name: "description", content: "Sign-in and access request for LockerOps." }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { signIn, signUp, user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
    else navigate({ to: "/" });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signUp(email, password, fullName);
    setBusy(false);
    if (error) {
      toast.error(error);
    } else {
      toast.success("Account requested — an administrator will approve your access shortly.");
      setTab("signin");
      setPassword("");
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast.error("Enter your email above first, then click Forgot password.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Password reset email sent. Check your inbox.");
  };

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-12">
        <div className="flex items-center gap-2 font-display font-bold text-xl">
          <div className="h-9 w-9 rounded-lg bg-sidebar-primary grid place-items-center">
            <Lock className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          LockerOps
        </div>
        <div>
          <h1 className="font-display text-4xl font-bold leading-tight">
            Manage 10,000+ lockers from one source of truth.
          </h1>
          <p className="mt-4 text-sidebar-foreground/70 max-w-md">
            Upload a single employee file to instantly detect resignations, see live occupancy on the
            interactive map, and track every key.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">New accounts require admin approval.</p>
      </div>

      <div className="flex items-center justify-center px-6 py-[max(env(safe-area-inset-top),3rem)] pb-[max(env(safe-area-inset-bottom),3rem)] lg:p-8">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-bold">Welcome to LockerOps</h2>
          <p className="text-muted-foreground text-sm mt-1">Sign in or request access.</p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Request access</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                <Field id="email" label="Email" type="email" value={email} onChange={setEmail} required />
                <Field id="password" label="Password" type="password" value={password} onChange={setPassword} required />
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  Forgot your password?
                </button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                <Field id="name" label="Full name" value={fullName} onChange={setFullName} required />
                <Field id="email2" label="Email" type="email" value={email} onChange={setEmail} required />
                <Field id="password2" label="Password" type="password" value={password} onChange={setPassword} required minLength={6} />
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Submitting…" : "Request access"}</Button>
                <p className="text-xs text-muted-foreground">
                  Your account will be created but inactive. An administrator must approve your access before you can sign in.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, type = "text", value, onChange, required, minLength }: {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void; required?: boolean; minLength?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} minLength={minLength} />
    </div>
  );
}
