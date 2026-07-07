import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, ClipboardCheck, CheckCircle2 } from "lucide-react";
import { useLang, type Lang } from "@/lib/i18n-find-locker";

export const Route = createFileRoute("/locker-identity-update")({
  head: () => ({
    meta: [
      { title: "Locker Identity Update" },
      { name: "description", content: "Register the identity of the current locker holder." },
    ],
  }),
  component: LockerIdentityUpdatePage,
});

const tr = {
  en: {
    title: "Locker Identity Update",
    subtitle:
      "Please fill in your locker information accurately. This information is required for internal records.",
    required: "* Indicates required question",
    lockerNumber: "Locker Number *",
    lockerHint: "Format: digits followed by one uppercase letter (e.g. 1411E)",
    lockerPlaceholder: "e.g. 1411E",
    badge: "Employee Number / Badge Number *",
    badgePlaceholder: "e.g. CS1234 / T012625 / 1011165",
    fullName: "Full Name *",
    stillUsing: "Are you still using this locker? *",
    yes: "Yes",
    no: "No",
    contact: "Phone Number *",
    contactPlaceholder: "e.g. 012-3456789",
    submit: "Submit",
    submitting: "Submitting…",
    privacy:
      "Your information is used only for locker record updates and is not shared publicly.",
    errors: {
      lockerFormat: "Locker number must be digits followed by one uppercase letter (e.g. 1411E).",
      badge: "Please enter your employee / badge number.",
      name: "Please enter your full name.",
      stillUsing: "Please answer whether you are still using this locker.",
      contact: "Please enter a valid phone number.",
      generic: "Couldn't submit right now — please try again shortly.",
      rate: "Too many submissions. Please try again in a few minutes.",
    },
    successTitle: "Response recorded",
    successBody: (id: string) =>
      `Thank you, your response has been recorded. Reference #${id}. Please remove the notice sticker from your locker now that you've registered.`,
  },
  bm: {
    title: "Kemas Kini Identiti Loker",
    subtitle:
      "Sila isikan maklumat loker anda dengan tepat. Maklumat ini diperlukan untuk rekod dalaman.",
    required: "* Menunjukkan soalan wajib",
    lockerNumber: "Nombor Loker *",
    lockerHint: "Format: digit diikuti satu huruf besar (cth. 1411E)",
    lockerPlaceholder: "cth. 1411E",
    badge: "Nombor Pekerja / Nombor Badge *",
    badgePlaceholder: "cth. CS1234 / T012625 / 1011165",
    fullName: "Nama Penuh *",
    stillUsing: "Adakah anda masih menggunakan loker ini? *",
    yes: "Ya",
    no: "Tidak",
    contact: "Nombor Telefon *",
    contactPlaceholder: "cth. 012-3456789",
    submit: "Hantar",
    submitting: "Menghantar…",
    privacy:
      "Maklumat anda hanya digunakan untuk kemas kini rekod loker dan tidak dikongsi secara umum.",
    errors: {
      lockerFormat: "Nombor loker mesti digit diikuti satu huruf besar (cth. 1411E).",
      badge: "Sila masukkan nombor pekerja / badge anda.",
      name: "Sila masukkan nama penuh anda.",
      stillUsing: "Sila jawab sama ada anda masih menggunakan loker ini.",
      contact: "Sila masukkan nombor telefon yang sah.",
      generic: "Gagal menghantar — sila cuba lagi sebentar.",
      rate: "Terlalu banyak penghantaran. Sila cuba lagi dalam beberapa minit.",
    },
    successTitle: "Respons direkodkan",
    successBody: (id: string) =>
      `Terima kasih, respons anda telah direkodkan. Rujukan #${id}. Sila tanggalkan pelekat notis dari loker anda selepas pendaftaran.`,
  },
} as const;

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

const lockerRe = /^[0-9]+[A-Z]$/;

function LockerIdentityUpdatePage() {
  const [lang, setLang] = useLang();
  const t = tr[lang];

  const [lockerNumber, setLockerNumber] = useState("");
  const [badge, setBadge] = useState("");
  const [fullName, setFullName] = useState("");
  const [stillUsing, setStillUsing] = useState<null | boolean>(null);
  const [contact, setContact] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  // Pre-fill locker from ?locker=1411E
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const l = params.get("locker");
    if (l) setLockerNumber(l.trim().toUpperCase());
  }, []);

  const scrollFocusIntoView = (e: React.FocusEvent<HTMLInputElement>) => {
    setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const schema = z.object({
      locker: z.string().regex(lockerRe, t.errors.lockerFormat),
      badge: z.string().trim().min(1, t.errors.badge).max(60),
      name: z.string().trim().min(1, t.errors.name).max(120),
      still: z.boolean({ invalid_type_error: t.errors.stillUsing, required_error: t.errors.stillUsing }),
      contact: z.string().trim().min(5, t.errors.contact).max(40),
    });
    const parsed = schema.safeParse({
      locker: lockerNumber.trim().toUpperCase(),
      badge,
      name: fullName,
      still: stillUsing,
      contact,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.errors.generic);
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("submit_locker_identity_claim", {
        _claim_type: "unknown_owner",
        _locker_number: parsed.data.locker,
        _badge_number: parsed.data.badge.trim(),
        _full_name: parsed.data.name.trim(),
        _contact_number: parsed.data.contact.trim(),
        _location: "",
        _still_using: parsed.data.still,
        _other_locker_numbers: [],
        _ip: "",
      });
      if (rpcErr) {
        if ((rpcErr.message ?? "").toLowerCase().includes("rate limit")) {
          setError(t.errors.rate);
        } else {
          setError(t.errors.generic);
        }
        return;
      }
      const id = (data as { id?: string } | null)?.id ?? "—";
      setSuccessId(id.slice(0, 8));
    } catch {
      setError(t.errors.generic);
    } finally {
      setLoading(false);
    }
  };

  if (successId) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="mx-auto w-full max-w-md px-5 pt-10 pb-24 sm:pb-10">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5 text-primary" /> {t.successTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{t.successBody(successId)}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-24 sm:pb-10">
        <div className="flex justify-end mb-2">
          <LanguageToggle lang={lang} setLang={setLang} />
        </div>

        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.subtitle}</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="h-4 w-4" /> {t.title}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t.required}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="locker" className="text-sm">{t.lockerNumber}</Label>
                <Input
                  id="locker"
                  value={lockerNumber}
                  onChange={(e) => setLockerNumber(e.target.value.toUpperCase())}
                  onFocus={scrollFocusIntoView}
                  placeholder={t.lockerPlaceholder}
                  required
                  autoComplete="off"
                  inputMode="text"
                  className="h-12 text-base"
                />
                <p className="text-xs text-muted-foreground">{t.lockerHint}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="badge" className="text-sm">{t.badge}</Label>
                <Input
                  id="badge"
                  value={badge}
                  onChange={(e) => setBadge(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  placeholder={t.badgePlaceholder}
                  required
                  autoComplete="off"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm">{t.fullName}</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  required
                  autoComplete="name"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">{t.stillUsing}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={stillUsing === true ? "default" : "outline"}
                    className="h-12 text-base"
                    onClick={() => setStillUsing(true)}
                    aria-pressed={stillUsing === true}
                  >
                    {t.yes}
                  </Button>
                  <Button
                    type="button"
                    variant={stillUsing === false ? "default" : "outline"}
                    className="h-12 text-base"
                    onClick={() => setStillUsing(false)}
                    aria-pressed={stillUsing === false}
                  >
                    {t.no}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact" className="text-sm">{t.contact}</Label>
                <Input
                  id="contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  placeholder={t.contactPlaceholder}
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  type="tel"
                  className="h-12 text-base"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {loading ? t.submitting : t.submit}
              </Button>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {t.privacy}
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
