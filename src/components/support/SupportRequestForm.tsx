import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import type { SupportRequestType } from "@/lib/support-requests";

export type SupportFormProps = {
  requestType: SupportRequestType;
  showLockerField?: boolean;
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
  const [okTicket, setOkTicket] = useState<string | null>(null);
  const [okBadge, setOkBadge] = useState<string>("");

  const scrollFocusIntoView = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  };

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
      const payload = data as { id: string; ticket_number?: string };
      setOkId(payload.id);
      setOkTicket(payload.ticket_number ?? null);
      setOkBadge(b);
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
          <div className="text-sm mt-1 break-words">
            Ticket number:{" "}
            <span className="font-mono font-semibold">
              {okTicket ?? `#${okId.slice(0, 8).toUpperCase()}`}
            </span>
          </div>
          <div className="text-xs mt-1 break-words">
            Save this number. Our team will contact you at{" "}
            <span className="font-mono">{contact}</span>.
          </div>
          {okTicket && (
            <div className="mt-3">
              <Link
                to="/ticket"
                search={{ t: okTicket, b: okBadge }}
                className="inline-flex items-center justify-center gap-1 h-11 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium w-full"
              >
                Check ticket status <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="sr-name" className="text-sm">Full name</Label>
          <Input
            id="sr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={scrollFocusIntoView}
            required
            autoComplete="name"
            inputMode="text"
            className="h-12 text-base"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-badge" className="text-sm">Badge number</Label>
          <Input
            id="sr-badge"
            value={badge}
            onChange={(e) => setBadge(e.target.value)}
            onFocus={scrollFocusIntoView}
            required
            autoComplete="off"
            inputMode="text"
            className="h-12 text-base"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-contact" className="text-sm">Contact number</Label>
          <Input
            id="sr-contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            onFocus={scrollFocusIntoView}
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 012-3456789"
            className="h-12 text-base"
          />
        </div>
        {showLockerField && (
          <div className="space-y-1.5">
            <Label htmlFor="sr-locker" className="text-sm">Current locker number (optional)</Label>
            <Input
              id="sr-locker"
              value={locker}
              onChange={(e) => setLocker(e.target.value)}
              onFocus={scrollFocusIntoView}
              autoComplete="off"
              inputMode="text"
              className="h-12 text-base"
            />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sr-message" className="text-sm">{messageLabel}</Label>
        <Textarea
          id="sr-message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={scrollFocusIntoView}
          placeholder={messagePlaceholder}
          maxLength={2000}
          required
          className="text-base min-h-[112px]"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full h-12 text-base" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
