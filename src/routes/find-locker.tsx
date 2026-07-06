import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, Search, Clock, ArrowRightLeft, MessageSquare } from "lucide-react";
import { HelpMenu } from "@/components/support/HelpMenu";
import { SupportRequestForm } from "@/components/support/SupportRequestForm";
import { t, useLang, type Lang } from "@/lib/i18n-find-locker";

export const Route = createFileRoute("/find-locker")({
  head: () => ({
    meta: [
      { title: "Locker Inquiry" },
      { name: "description", content: "Look up your assigned locker or request a transfer." },
    ],
  }),
  component: LockerInquiryPage,
});

type Result = { employee_name: string | null; badge_number: string | null; locker_number: string | null };

function OperatingHoursNotice({ lang }: { lang: Lang }) {
  const tr = t[lang];
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs sm:text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Clock className="h-4 w-4 text-primary" />
        <span>{tr.officeHours.heading}</span>
      </div>
      <p className="mt-1 text-muted-foreground">{tr.officeHours.hours}</p>
      <p className="mt-1 text-muted-foreground">{tr.officeHours.outside}</p>
    </div>
  );
}

function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border bg-background p-0.5 text-xs">
      {(["en", "bm"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`px-3 h-7 rounded-full font-medium transition-colors ${
            lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
          aria-pressed={lang === l}
        >
          {l === "en" ? "EN" : "BM"}
        </button>
      ))}
    </div>
  );
}

function LockerInquiryPage() {
  const [lang, setLang] = useLang();
  const tr = t[lang];

  const [lockerNumber, setLockerNumber] = useState("");
  const [badgeNumber, setBadgeNumber] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showCantFind, setShowCantFind] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setShowTransfer(false);
    setShowCantFind(false);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("locker-lookup", {
        body: {
          badge_number: badgeNumber.trim(),
          locker_number: lockerNumber.trim() || undefined,
        },
      });
      if (error || !data || (data as { error?: string }).error) {
        const msg = (data as { error?: string } | null)?.error ?? error?.message ?? "";
        if (msg.toLowerCase().includes("too many")) {
          setError(tr.lookup.tooMany);
        } else {
          setError(tr.lookup.noMatch);
        }
        return;
      }
      setResult(data as Result);
    } catch {
      setError(tr.lookup.noMatch);
    } finally {
      setLoading(false);
    }
  };

  const lookupRef = useRef<HTMLDivElement | null>(null);

  const scrollFocusIntoView = (e: React.FocusEvent<HTMLInputElement>) => {
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-24 sm:pb-10">
        <div className="flex justify-end mb-2">
          <LanguageToggle lang={lang} setLang={setLang} />
        </div>

        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{tr.pageTitle}</h1>
          <p className="text-sm text-muted-foreground mt-1">{tr.pageSubtitle}</p>
        </div>

        <div ref={lookupRef}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Search className="h-4 w-4" /> {tr.lookup.cardTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="locker" className="text-sm">{tr.lookup.lockerNumber}</Label>
                  <Input
                    id="locker"
                    value={lockerNumber}
                    onChange={(e) => setLockerNumber(e.target.value)}
                    onFocus={scrollFocusIntoView}
                    autoComplete="off"
                    inputMode="text"
                    placeholder={tr.lookup.lockerNumberHint}
                    className="h-12 text-base"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="badge" className="text-sm">{tr.lookup.badge}</Label>
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
                  {tr.lookup.submit}
                </Button>

                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {tr.lookup.privacyNote}
                </p>
              </form>

              {error && (
                <div className="mt-4 space-y-3">
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                  {!showCantFind ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-12 text-base"
                      onClick={() => setShowCantFind(true)}
                    >
                      <MessageSquare className="h-4 w-4 mr-2" />
                      {tr.lookup.cantFindCta}
                    </Button>
                  ) : (
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <SupportRequestForm
                        lang={lang}
                        requestType="cant_find_locker"
                        showLockerField={false}
                        initialBadge={badgeNumber.trim()}
                        defaultMessage={tr.cantFindPanel.defaultMessage}
                        messageLabel={tr.cantFindPanel.messageLabel}
                        messagePlaceholder={tr.cantFindPanel.messagePlaceholder}
                        submitLabel={tr.cantFindPanel.submitLabel}
                      />
                    </div>
                  )}
                </div>
              )}

              {result && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-lg border border-border bg-muted/40 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                      {tr.lookup.resultTitle}
                    </p>
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{tr.lookup.resultName}</dt>
                        <dd className="font-medium text-right break-words">{result.employee_name ?? "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{tr.lookup.resultBadge}</dt>
                        <dd className="font-medium text-right break-words">{result.badge_number ?? "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{tr.lookup.resultLocker}</dt>
                        <dd className="font-mono font-semibold text-right">{result.locker_number ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>

                  {!showTransfer ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-12 text-base"
                      onClick={() => setShowTransfer(true)}
                    >
                      <ArrowRightLeft className="h-4 w-4 mr-2" />
                      {tr.lookup.requestTransfer}
                    </Button>
                  ) : (
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                      <p className="text-sm">{tr.transferPanel.intro}</p>
                      <SupportRequestForm
                        lang={lang}
                        requestType="transfer_locker"
                        showLockerField
                        initialName={result.employee_name ?? ""}
                        initialBadge={result.badge_number ?? ""}
                        initialLocker={result.locker_number ?? ""}
                        messageLabel={tr.transferPanel.messageLabel}
                        messagePlaceholder={tr.transferPanel.messagePlaceholder}
                        submitLabel={tr.transferPanel.submitLabel}
                      />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <OperatingHoursNotice lang={lang} />

        <HelpMenu
          lang={lang}
          onPickInquiry={() => lookupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      </div>
    </div>
  );
}
