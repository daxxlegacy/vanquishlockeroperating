import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { SupportRequestType } from "@/lib/support-requests";

export type SupportFormProps = {
  requestType: SupportRequestType;
  /** Show/hide "Current locker number" field. Always sent when present. */
  showLockerField?: boolean;
  /** Optional default message prefill (e.g. "Can't find my locker"). */
  defaultMessage?: string;
  messageLabel?: string;
  messagePlaceholder?: string;
  submitLabel?: string;
};

export function SupportRequestForm({
  requestType,
  showLockerField = true,
  defaultMessage = "",
  messageLabel = "Reason / message",
  messagePlaceholder = "Tell us briefly what you need help with…",
  submitLabel = "Submit request",
}: SupportFormProps) {
  const [name, setName] = useState("");
  const [badge, setBadge] = useState("");
  const [locker, setLocker] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okId, setOkId] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const n = name.trim();
    const b = badge.trim();
    const c = contact.trim();
    const m = message.trim();

    if (!n || n.length > 120) return setError("Please enter your full name.");
    if (!b || b.length > 60) return setError("Please enter your badge number.");
    if (!c || c.length > 40) return setError("Please enter a contact number.");
    if (!m || m.length > 2000) return setError("Please describe your request.");
    if (locker.length > 60) return setError("Locker number is too long.");

    setBusy(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("submit-support-request", {
        body: {
          request_type: requestType,
          name: n,
          badge_number: b,
          locker_number: showLockerField ? locker.trim() || null : null,
          contact_number: c,
          message: m,
        },
      });
      if (err || !data || (data as { error?: string }).error) {
        const msg = (data as { error?: string } | null)?.error ?? err?.message ?? "";
        if (msg.toLowerCase().includes("too many")) {
          setError("Too many requests. Please try again in a few minutes.");
        } else {
          setError("Couldn't submit right now — please try again or contact the admin office.");
        }
        return;
      }
      setOkId((data as { id: string }).id);
    } catch {
      setError("Couldn't submit right now — please try again or contact the admin office.");
    } finally {
      setBusy(false);
    }
  };

  if (okId) {
    return (
      <Alert className="border-success/40 bg-success/10">
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          <div className="font-medium">Your request has been received.</div>
          <div className="text-xs mt-1">
            Reference #{okId.slice(0, 8).toUpperCase()}. Our team will contact you at{" "}
            <span className="font-mono">{contact}</span> shortly.
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sr-name">Full name</Label>
          <Input id="sr-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="sr-badge">Badge number</Label>
          <Input id="sr-badge" value={badge} onChange={(e) => setBadge(e.target.value)} required autoComplete="off" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sr-contact">Contact number</Label>
          <Input
            id="sr-contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 012-3456789"
          />
        </div>
        {showLockerField && (
          <div>
            <Label htmlFor="sr-locker">Current locker number (optional)</Label>
            <Input id="sr-locker" value={locker} onChange={(e) => setLocker(e.target.value)} autoComplete="off" />
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="sr-message">{messageLabel}</Label>
        <Textarea
          id="sr-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={messagePlaceholder}
          maxLength={2000}
          required
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
