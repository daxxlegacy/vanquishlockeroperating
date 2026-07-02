import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, Search } from "lucide-react";

export const Route = createFileRoute("/find-locker")({
  head: () => ({
    meta: [
      { title: "Find My Locker" },
      { name: "description", content: "Look up your assigned locker using your badge number and IC last 4 digits." },
    ],
  }),
  component: FindLockerPage,
});

type Result = { employee_name: string | null; badge_number: string | null; locker_number: string | null };

function FindLockerPage() {
  const [badgeNumber, setBadgeNumber] = useState("");
  const [nidLast4, setNidLast4] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!/^\d{4}$/.test(nidLast4)) {
      setError("Please enter the last 4 digits of your IC/National ID.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("locker-lookup", {
        body: {
          badge_number: badgeNumber.trim(),
          national_id_last4: nidLast4.trim(),
        },
      });
      if (error || !data || (data as { error?: string }).error) {
        const msg = (data as { error?: string } | null)?.error ?? error?.message ?? "";
        if (msg.toLowerCase().includes("too many")) {
          setError("Too many attempts. Please try again in a few minutes.");
        } else {
          setError("No matching record found. Please check your details or contact the admin office.");
        }
        return;
      }
      setResult(data as Result);
    } catch {
      setError("No matching record found. Please check your details or contact the admin office.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Find My Locker</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your details to look up your assigned locker.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-4 w-4" /> Locker lookup
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="badge">Badge number</Label>
                <Input id="badge" value={badgeNumber} onChange={(e) => setBadgeNumber(e.target.value)} required autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="nid">Last 4 digits of IC / National ID</Label>
                <Input
                  id="nid"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={nidLast4}
                  onChange={(e) => setNidLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  required
                  autoComplete="off"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Find my locker
              </Button>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                For your security, we only ask for the last 4 digits of your IC/National ID.
              </p>
            </form>

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {result && (
              <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Your locker</p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{result.employee_name ?? "—"}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Badge</dt><dd className="font-medium">{result.badge_number ?? "—"}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Locker</dt><dd className="font-mono font-semibold">{result.locker_number ?? "—"}</dd></div>
                </dl>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
