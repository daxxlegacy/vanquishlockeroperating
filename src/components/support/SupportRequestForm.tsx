import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, ExternalLink, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import type { SupportRequestType } from "@/lib/support-requests";
import { t, type Lang } from "@/lib/i18n-find-locker";

export type SupportFormProps = {
  requestType: SupportRequestType;
  showLockerField?: boolean;
  defaultMessage?: string;
  messageLabel?: string;
  messagePlaceholder?: string;
  submitLabel?: string;
  /** Optional prefilled values from the lookup flow. */
  initialName?: string;
  initialBadge?: string;
  initialLocker?: string;
  /** UI language for labels/validation/success text. */
  lang?: Lang;
};

export function SupportRequestForm({
  requestType,
  showLockerField = true,
  defaultMessage = "",
  messageLabel,
  messagePlaceholder,
  submitLabel,
  initialName = "",
  initialBadge = "",
  initialLocker = "",
  lang = "en",
}: SupportFormProps) {
  const tr = t[lang];
  const [name, setName] = useState(initialName);
  const [badge, setBadge] = useState(initialBadge);
  const [locker, setLocker] = useState(initialLocker);
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTicket, setOpenTicket] = useState<{ ticket: string; status: string } | null>(null);
  const [okId, setOkId] = useState<string | null>(null);
  const [okTicket, setOkTicket] = useState<string | null>(null);
  const [okBadge, setOkBadge] = useState<string>("");
  const [copied, setCopied] = useState(false);

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
    setOpenTicket(null);

    const n = name.trim();
    const b = badge.trim();
    const c = contact.trim();
    const m = message.trim();

    if (!n || n.length > 120) return setError(tr.form.errName);
    if (!b || b.length > 60) return setError(tr.form.errBadge);
    if (!c || c.length > 40) return setError(tr.form.errContact);
    if (!m || m.length > 2000) return setError(tr.form.errMessage);
    if (locker.length > 60) return setError(tr.form.errLocker);

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
        const payload = data as
          | { error?: string; existing?: { ticket_number?: string; status?: string } }
          | null;
        const msg = payload?.error ?? err?.message ?? "";
        if (msg === "open_ticket_exists" && payload?.existing?.ticket_number) {
          setOpenTicket({
            ticket: payload.existing.ticket_number,
            status: payload.existing.status ?? "new",
          });
        } else if (msg.toLowerCase().includes("too many")) {
          setError(tr.form.errTooMany);
        } else {
          setError(tr.form.errGeneric);
        }
        return;
      }
      const payload = data as { id: string; ticket_number?: string };
      setOkId(payload.id);
      setOkTicket(payload.ticket_number ?? null);
      setOkBadge(b);
    } catch {
      setError(tr.form.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  if (okId) {
    return (
      <Alert className="border-success/40 bg-success/10">
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          <div className="font-medium">{tr.form.okHeading}</div>
          <div className="text-sm mt-1 break-words">
            {tr.form.okTicket}{" "}
            <span className="font-mono font-semibold">
              {okTicket ?? `#${okId.slice(0, 8).toUpperCase()}`}
            </span>
          </div>
          <div className="text-xs mt-1 break-words">
            {tr.form.okSaveNumber}{" "}
            <span className="font-mono">{contact}</span>.
          </div>
          {okTicket && (
            <div className="mt-3">
              <Link
                to="/ticket"
                search={{ t: okTicket, b: okBadge }}
                className="inline-flex items-center justify-center gap-1 h-11 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium w-full"
              >
                {tr.form.okCheckStatus} <ExternalLink className="h-3.5 w-3.5" />
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
          <Label htmlFor="sr-name" className="text-sm">{tr.form.fullName}</Label>
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
          <Label htmlFor="sr-badge" className="text-sm">{tr.form.badge}</Label>
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
          <Label htmlFor="sr-contact" className="text-sm">{tr.form.contact}</Label>
          <Input
            id="sr-contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            onFocus={scrollFocusIntoView}
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder={tr.form.contactPlaceholder}
            className="h-12 text-base"
          />
        </div>
        {showLockerField && (
          <div className="space-y-1.5">
            <Label htmlFor="sr-locker" className="text-sm">{tr.form.lockerOptional}</Label>
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
        <Label htmlFor="sr-message" className="text-sm">{messageLabel ?? tr.transferPanel.messageLabel}</Label>
        <Textarea
          id="sr-message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={scrollFocusIntoView}
          placeholder={messagePlaceholder ?? tr.transferPanel.messagePlaceholder}
          maxLength={2000}
          required
          className="text-base min-h-[112px]"
        />
      </div>

      {openTicket && (
        <Alert variant="destructive">
          <AlertDescription>
            <div>
              {tr.form.errOpenTicket(
                openTicket.ticket,
                openTicket.status === "in_progress"
                  ? tr.form.statusInProgress
                  : tr.form.statusNew,
              )}
            </div>
            <div className="mt-3">
              <Link
                to="/ticket"
                search={{ t: openTicket.ticket, b: badge.trim() }}
                className="inline-flex items-center justify-center gap-1 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                {tr.form.errOpenTicketCta} <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {error && !openTicket && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full h-12 text-base" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        {submitLabel ?? tr.transferPanel.submitLabel}
      </Button>
    </form>
  );
}
