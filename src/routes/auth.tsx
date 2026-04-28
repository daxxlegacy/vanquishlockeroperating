import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Sign in — LockerOps" }, { name: "description", content: "Admin sign-in for LockerOps." }],
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
    if (error) toast.error(error);
    else {
      toast.success("Account created — signing you in…");
      const r = await signIn(email, password);
      if (!r.error) navigate({ to: "/" });
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
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
          <div className="mt-8 flex gap-6 text-sm">
            <Stat color="bg-success" label="Active" />
            <Stat color="bg-destructive" label="Occupied" />
            <Stat color="bg-warning" label="Repair" />
            <Stat color="bg-muted-foreground" label="Empty" />
          </div>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Secure admin access only.</p>
      </div>

      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-bold">Welcome back</h2>
          <p className="text-muted-foreground text-sm mt-1">Sign in to manage lockers.</p>

          <Tabs defaultValue="signin" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                <Field id="email" label="Email" type="email" value={email} onChange={setEmail} required />
                <Field id="password" label="Password" type="password" value={password} onChange={setPassword} required />
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                <Field id="name" label="Full name" value={fullName} onChange={setFullName} required />
                <Field id="email2" label="Email" type="email" value={email} onChange={setEmail} required />
                <Field id="password2" label="Password" type="password" value={password} onChange={setPassword} required minLength={6} />
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
                <p className="text-xs text-muted-foreground">First account becomes admin automatically.</p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function Stat({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded-sm ${color}`} />
      <span className="text-sidebar-foreground/80">{label}</span>
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
