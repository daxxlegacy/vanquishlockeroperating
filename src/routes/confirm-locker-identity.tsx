import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, CheckCircle2, ShieldCheck, Plus, X, MessageSquare } from "lucide-react";

const LOCKER_RE = /^[0-9]+[A-Z]$/;
const LOCATIONS = ["IJM", "IPOH", "P2"] as const;

const searchSchema = z.object({
  locker: z.string().optional(),
  type: z.enum(["unknown_owner", "multiple_locker"]).optional(),
});

export const Route = createFileRoute("/confirm-locker-identity")({
  head: () => ({
    meta: [
      { title: "Confirm Locker Identity" },
      { name: "description", content: "Confirm your locker assignment via QR." },
    ],
  }),
  validateSearch: searchSchema,
  component: ConfirmLockerIdentityPage,
});

type ClaimType = "unknown_owner" | "multiple_locker";

function ConfirmLockerIdentityPage() {
  const search = useSearch({ from: "/confirm-locker-identity" });
  const initialLocker = (search.locker ?? "").toUpperCase();
  const claimType: ClaimType = search.type ?? "unknown_owner";
  const lockerFromQr = !!search.locker;

  const [lockerNumber, setLockerNumber] = useState(initialLocker);
  const [badgeNumber, setBadgeNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [contact, setContact] = useState("");
  const [location, setLocation] = useState<string>("");
  const [stillUsing, setStillUsing] = useState<"yes" | "no" | "">("");
  const [otherLockers, setOtherLockers] = useState<string[]>([""]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refId, setRefId] = useState<string | null>(null);

  const heading = useMemo(
    () => (claimType === "multiple_locker" ? "Confirm Locker Identity" : "Confirm Locker Identity"),
    [claimType],
  );
  const subheading = useMemo(
    () =>
      claimType === "multiple_locker"
        ? "Please confirm which locker you are currently using. Only 1 user per locker — unconfirmed lockers will be marked for repair."
        : "This locker's owner is not on record. Please confirm your details below within 3 days, or this locker will be marked for repair/blocked pending review.",
    [claimType],
  );

  const scrollFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
  };

  const validate = (): string | null => {
    if (!LOCKER_RE.test(lockerNumber.trim().toUpperCase())) {
      return "Please enter a valid locker number (e.g. 1411E).";
    }
    if (!badgeNumber.trim()) return "Badge / Employee Number is required.";
    if (!fullName.trim()) return "Full Name is required.";
    if (!contact.trim()) return "Contact Number is required.";
    if (claimType === "unknown_owner" && !location) return "Location is required.";
    if (claimType === "multiple_locker" && stillUsing === "") {
      return "Please tell us if you are still using this locker.";
    }
    const others = otherLockers.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (others.some((o) => !LOCKER_RE.test(o))) {
      return "One of the additional locker numbers is not valid (e.g. 1411E).";
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }

    setBusy(true);
    try {
      const others = otherLockers.map((s) => s.trim().toUpperCase()).filter(Boolean);
      const { data, error: fnErr } = await supabase.functions.invoke("submit-locker-identity-claim", {
        body: {
          claim_type: claimType,
          locker_number: lockerNumber.trim().toUpperCase(),
          badge_number: badgeNumber.trim(),
          full_name: fullName.trim(),
          contact_number: contact.trim(),
          location: claimType === "unknown_owner" ? location : null,
          still_using: claimType === "multiple_locker" ? stillUsing === "yes" : null,
          other_locker_numbers: claimType === "multiple_locker" && others.length ? others : null,
        },
      });
      const payload = (data ?? {}) as { id?: string; error?: string };
      if (fnErr || payload.error) {
        const msg = (payload.error ?? fnErr?.message ?? "").toLowerCase();
        if (msg.includes("too many")) {
          setError("Too many submissions. Please try again in a few minutes.");
        } else {
          setError("Could not submit your response. Please try again shortly.");
        }
        return;
      }
      setRefId(payload.id ?? null);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (refId) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="mx-auto w-full max-w-md px-5 pt-10 pb-24 sm:pb-10">
          <div className="rounded-xl border bg-card p-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
            <h1 className="text-xl font-bold">Thank you</h1>
            <p className="text-sm text-muted-foreground">
              Your response has been recorded. Our team will review it shortly.
            </p>
            <p className="text-xs text-muted-foreground">
              Reference #<span className="font-mono">{refId.slice(0, 8).toUpperCase()}</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 sm:pb-10">
        <div className="text-center mb-5">
          <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mt-1">
            {claimType === "multiple_locker" ? "Multiple Locker Confirmation" : "Unknown Owner Confirmation"}
          </p>
        </div>

        <Alert className="mb-4">
          <AlertDescription className="text-sm">{subheading}</AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Your details</CardTitle>
            <p className="text-xs text-muted-foreground">* Indicates required question</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="locker" className="text-sm">Locker Number *</Label>
                <Input
                  id="locker"
                  value={lockerNumber}
                  onChange={(e) => setLockerNumber(e.target.value.toUpperCase())}
                  onFocus={scrollFocus}
                  readOnly={lockerFromQr}
                  required
                  placeholder="e.g. 1411E"
                  inputMode="text"
                  autoComplete="off"
                  className={`h-12 text-base ${lockerFromQr ? "bg-muted font-mono" : ""}`}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="badge" className="text-sm">Badge / Employee Number *</Label>
                <Input
                  id="badge"
                  value={badgeNumber}
                  onChange={(e) => setBadgeNumber(e.target.value)}
                  onFocus={scrollFocus}
                  required
                  inputMode="text"
                  autoComplete="off"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm">Full Name *</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onFocus={scrollFocus}
                  required
                  autoComplete="name"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact" className="text-sm">Contact Number *</Label>
                <Input
                  id="contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  onFocus={scrollFocus}
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="h-12 text-base"
                />
              </div>

              {claimType === "unknown_owner" && (
                <div className="space-y-1.5">
                  <Label htmlFor="location" className="text-sm">Location *</Label>
                  <Select value={location} onValueChange={setLocation}>
                    <SelectTrigger id="location" className="h-12 text-base">
                      <SelectValue placeholder="Select a location" />
                    </SelectTrigger>
                    <SelectContent>
                      {LOCATIONS.map((loc) => (
                        <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {claimType === "multiple_locker" && (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm">Are you still using this locker? *</Label>
                    <RadioGroup
                      value={stillUsing}
                      onValueChange={(v) => setStillUsing(v as "yes" | "no")}
                      className="grid grid-cols-2 gap-2"
                    >
                      <label className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer">
                        <RadioGroupItem value="yes" id="using-yes" />
                        <span className="text-sm">Yes, I still use it</span>
                      </label>
                      <label className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer">
                        <RadioGroupItem value="no" id="using-no" />
                        <span className="text-sm">No, I don't</span>
                      </label>
                    </RadioGroup>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Other locker numbers you currently hold</Label>
                    <p className="text-xs text-muted-foreground">
                      Optional. Add each locker you are also using so we can see the full picture.
                    </p>
                    {otherLockers.map((val, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          value={val}
                          onChange={(e) => {
                            const copy = [...otherLockers];
                            copy[idx] = e.target.value.toUpperCase();
                            setOtherLockers(copy);
                          }}
                          onFocus={scrollFocus}
                          placeholder="e.g. 1412E"
                          inputMode="text"
                          autoComplete="off"
                          className="h-12 text-base"
                        />
                        {otherLockers.length > 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-12 w-12 shrink-0"
                            onClick={() =>
                              setOtherLockers(otherLockers.filter((_, i) => i !== idx))
                            }
                            aria-label="Remove locker"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-11"
                      onClick={() => setOtherLockers([...otherLockers, ""])}
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add another locker number
                    </Button>
                  </div>
                </>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full h-12 text-base" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Submit Confirmation
              </Button>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Your response goes to a review queue. No changes are made to locker records until an
                administrator approves it.
              </p>
            </form>
          </CardContent>
        </Card>

        <a
          href="/find-locker"
          className="fixed bottom-4 left-4 right-4 mx-auto max-w-md flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground h-12 text-sm font-medium shadow-lg sm:static sm:mt-6 sm:shadow-none"
        >
          <MessageSquare className="h-4 w-4" />
          Need help? Contact us
        </a>
      </div>
    </div>
  );
}
