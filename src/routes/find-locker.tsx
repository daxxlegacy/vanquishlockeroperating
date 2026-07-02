import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, Search, Clock } from "lucide-react";
import { HelpMenu } from "@/components/support/HelpMenu";

function OperatingHoursNotice() {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs sm:text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Clock className="h-4 w-4 text-primary" />
        <span>Admin office hours / Waktu pejabat pentadbir</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        Monday – Friday, 8:00 AM – 5:15 PM
        <br />
        Isnin – Jumaat, 8:00 pagi – 5:15 petang
      </p>
      <p className="mt-1 text-muted-foreground">
        Requests outside office hours are handled the next business day.
        <br />
        Permintaan di luar waktu pejabat akan diuruskan pada hari bekerja berikutnya.
      </p>
    </div>
  );
}

export const Route = createFileRoute("/find-locker")({
  head: () => ({
    meta: [
      { title: "Find My Locker" },
      { name: "description", content: "Look up your assigned locker using your badge number." },
    ],
  }),
  component: FindLockerPage,
});

type Result = { employee_name: string | null; badge_number: string | null; locker_number: string | null };

function FindLockerPage() {
  const [badgeNumber, setBadgeNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("locker-lookup", {
        body: { badge_number: badgeNumber.trim() },
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

  const lookupRef = useRef<HTMLDivElement | null>(null);

  const scrollFocusIntoView = (e: React.FocusEvent<HTMLInputElement>) => {
    // Ensure the focused field is not hidden behind the mobile keyboard.
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto w-full max-w-md px-5 pt-8 pb-24 sm:pb-10">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Find My Locker</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your badge number to look up your assigned locker.
          </p>
        </div>

        <div ref={lookupRef}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Search className="h-4 w-4" /> Locker lookup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="badge" className="text-sm">Badge number</Label>
                  <Input
                    id="badge"
                    value={badgeNumber}
                    onChange={(e) => setBadgeNumber(e.target.value)}
                    onFocus={scrollFocusIntoView}
                    required
                    autoComplete="off"
                    inputMode="text"
                    className="h-12 text-base"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 text-base"
                  disabled={loading}
                >
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Find my locker
                </Button>

                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Your badge number is used only to look up your assigned locker.
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
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Name</dt><dd className="font-medium text-right break-words">{result.employee_name ?? "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Badge</dt><dd className="font-medium text-right break-words">{result.badge_number ?? "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Locker</dt><dd className="font-mono font-semibold text-right">{result.locker_number ?? "—"}</dd></div>
                  </dl>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <HelpMenu onPickFind={() => lookupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      </div>
    </div>
  );
}
