import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, ClipboardCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import lockerDiagram from "@/assets/locker-diagram.png.asset.json";

export const Route = createFileRoute("/locker-identity-update")({
  head: () => ({
    meta: [
      { title: "Kemas Kini Identiti Loker" },
      { name: "description", content: "Daftarkan identiti pemilik loker semasa." },
    ],
  }),
  component: LockerIdentityUpdatePage,
});

const lockerRe = /^([0-9]+[A-Z]+|[A-Z]+[0-9]+)$/;

const ERR = {
  lockerFormat: "Nombor loker mesti digit+huruf (cth. 1411E) atau huruf+digit (cth. B08).",
  badge: "Sila masukkan nombor pekerja / badge anda.",
  name: "Sila masukkan nama penuh anda.",
  stillUsing: "Sila jawab sama ada anda masih menggunakan loker ini.",
  contact: "Sila masukkan nombor telefon yang sah.",
  generic: "Gagal menghantar — sila cuba lagi sebentar.",
  rate: "Terlalu banyak penghantaran. Sila cuba lagi dalam beberapa minit.",
  pickLocker: "Sila pilih loker yang sedang anda gunakan.",
};

const DUP_WARN_BM =
  "Kami mengesan lebih daripada satu loker didaftarkan atas nama anda. Sila pilih loker yang sedang anda gunakan — mana-mana loker lain yang didaftarkan atas nama anda akan dinyahaktifkan dan ditanda untuk pembaikan.";
const DUP_WARN_EN =
  "We detected more than one locker registered under your name. Please select which locker you are currently using — any other locker registered to you will be deactivated and marked for repair.";

function LockerIdentityUpdatePage() {
  const [mode, setMode] = useState<"identity" | "multiple_locker">("identity");
  const [lockerNumber, setLockerNumber] = useState("");
  const [badge, setBadge] = useState("");
  const [fullName, setFullName] = useState("");
  const [stillUsing, setStillUsing] = useState<null | boolean>(null);
  const [contact, setContact] = useState("");

  // Duplicate-resolution mode: lockers currently registered to this badge.
  const [foundLockers, setFoundLockers] = useState<string[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [othersText, setOthersText] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const l = params.get("locker");
    if (l) setLockerNumber(l.trim().toUpperCase());
    const b = params.get("badge");
    if (b) setBadge(b.trim());
    if (params.get("type") === "multiple_locker") {
      setMode("multiple_locker");
      setStillUsing(true);
    }
  }, []);

  // Look up the lockers registered to this badge so the employee confirms
  // rather than typing from memory.
  useEffect(() => {
    if (mode !== "multiple_locker" || !badge.trim()) return;
    let cancelled = false;
    setLookupLoading(true);
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("locker-lookup", {
          body: { badge_number: badge.trim() },
        });
        if (cancelled) return;
        const results = (data as { results?: { locker_number: string | null; employee_name: string | null }[] } | null)
          ?.results ?? [];
        const lockers = [
          ...new Set(
            results
              .map((r) => (r.locker_number ?? "").trim().toUpperCase())
              .filter((v) => lockerRe.test(v)),
          ),
        ];
        setFoundLockers(lockers);
        const name = results.find((r) => (r.employee_name ?? "").trim())?.employee_name;
        if (name) setFullName((prev) => prev || name.trim());
      } catch {
        /* leave manual entry available */
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only run on the initial badge value supplied by the QR link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, badge.trim()]);

  // Keep the "other lockers" field in sync with the selection.
  useEffect(() => {
    if (mode !== "multiple_locker") return;
    const others = foundLockers.filter((l) => l !== lockerNumber.trim().toUpperCase());
    setOthersText(others.join(", "));
  }, [mode, foundLockers, lockerNumber]);

  const scrollFocusIntoView = (e: React.FocusEvent<HTMLInputElement>) => {
    setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const schema = z.object({
      locker: z.string().regex(lockerRe, mode === "multiple_locker" ? ERR.pickLocker : ERR.lockerFormat),
      badge: z.string().trim().min(1, ERR.badge).max(60),
      name: z.string().trim().min(1, ERR.name).max(120),
      still: z.boolean({ invalid_type_error: ERR.stillUsing, required_error: ERR.stillUsing }),
      contact: z.string().trim().min(5, ERR.contact).max(40),
    });
    const parsed = schema.safeParse({
      locker: lockerNumber.trim().toUpperCase(),
      badge,
      name: fullName,
      still: mode === "multiple_locker" ? true : stillUsing,
      contact,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ERR.generic);
      return;
    }

    const others =
      mode === "multiple_locker"
        ? [
            ...new Set(
              othersText
                .split(/[,\s]+/)
                .map((v) => v.trim().toUpperCase())
                .filter((v) => v.length > 0),
            ),
          ].filter((v) => v !== parsed.data.locker)
        : [];
    if (mode === "multiple_locker" && others.some((v) => !lockerRe.test(v))) {
      setError(ERR.lockerFormat);
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.functions.invoke("submit-locker-identity-claim", {
        body: {
          claim_type: mode === "multiple_locker" ? "multiple_locker" : "unknown_owner",
          locker_number: parsed.data.locker,
          badge_number: parsed.data.badge.trim(),
          full_name: parsed.data.name.trim(),
          contact_number: parsed.data.contact.trim(),
          location: "",
          still_using: parsed.data.still,
          other_locker_numbers: others,
        },
      });
      if (rpcErr) {
        if ((rpcErr.message ?? "").toLowerCase().includes("rate limit")) {
          setError(ERR.rate);
        } else {
          setError(ERR.generic);
        }
        return;
      }
      const id = (data as { id?: string } | null)?.id ?? "—";
      setSuccessId(id.slice(0, 8));
    } catch {
      setError(ERR.generic);
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
                <CheckCircle2 className="h-5 w-5 text-primary" /> Respons direkodkan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed">
                {mode === "multiple_locker"
                  ? `Terima kasih. Pilihan anda (loker ${lockerNumber.trim().toUpperCase()}) telah direkodkan untuk semakan pentadbir. Rujukan #${successId}.`
                  : `Terima kasih, respons anda telah direkodkan. Rujukan #${successId}. Sila tanggalkan pelekat notis dari loker anda selepas pendaftaran.`}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const dup = mode === "multiple_locker";
  const selected = lockerNumber.trim().toUpperCase();

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-24 sm:pb-10">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">
            {dup ? "Penyelesaian Loker Berganda" : "Kemas Kini Identiti Loker"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {dup
              ? "Sila pilih loker yang sedang anda gunakan."
              : "Sila isikan maklumat loker anda dengan tepat. Maklumat ini diperlukan untuk rekod dalaman."}
          </p>
        </div>

        {dup && (
          <Alert className="mb-5 border-amber-500/60 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="space-y-2 text-sm">
              <p className="font-medium leading-relaxed">{DUP_WARN_BM}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{DUP_WARN_EN}</p>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="h-4 w-4" />
              {dup ? "Pilih Loker Anda" : "Kemas Kini Identiti Loker"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              * Menunjukkan soalan wajib
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {dup ? (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Loker yang sedang anda gunakan *
                  </Label>
                  {lookupLoading ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuatkan loker yang didaftarkan…
                    </p>
                  ) : foundLockers.length > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Loker yang didaftarkan atas nama anda:
                      </p>
                      <div className="grid gap-2">
                        {foundLockers.map((l) => (
                          <Button
                            key={l}
                            type="button"
                            variant={selected === l ? "default" : "outline"}
                            className="h-12 justify-start text-base font-mono"
                            aria-pressed={selected === l}
                            onClick={() => setLockerNumber(l)}
                          >
                            {l}
                            {selected === l && <CheckCircle2 className="h-4 w-4 ml-auto" />}
                          </Button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Input
                      id="locker"
                      value={lockerNumber}
                      onChange={(e) => setLockerNumber(e.target.value.toUpperCase())}
                      onFocus={scrollFocusIntoView}
                      placeholder="cth. 1411E atau B08"
                      required
                      autoComplete="off"
                      className="h-12 text-base"
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="locker" className="text-sm font-medium">Nombor Loker *</Label>
                  <Input
                    id="locker"
                    value={lockerNumber}
                    onChange={(e) => setLockerNumber(e.target.value.toUpperCase())}
                    onFocus={scrollFocusIntoView}
                    placeholder="cth. 1411E atau B08"
                    required
                    autoComplete="off"
                    inputMode="text"
                    className="h-12 text-base"
                  />
                  <p className="text-xs text-muted-foreground">
                    Format: digit + satu huruf (cth. 1411E) atau huruf + digit (cth. B08)
                  </p>
                </div>
              )}

              {dup && (
                <div className="space-y-1.5">
                  <Label htmlFor="others" className="text-sm font-medium">
                    Loker lain yang didaftarkan atas nama anda
                  </Label>
                  <Input
                    id="others"
                    value={othersText}
                    onChange={(e) => setOthersText(e.target.value.toUpperCase())}
                    onFocus={scrollFocusIntoView}
                    placeholder="cth. 1411E, B08"
                    autoComplete="off"
                    className="h-12 text-base font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Loker ini akan dinyahaktifkan dan ditanda untuk pembaikan selepas pengesahan pentadbir.
                  </p>
                  {othersText.trim() && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {othersText
                        .split(/[,\s]+/)
                        .map((v) => v.trim().toUpperCase())
                        .filter(Boolean)
                        .map((v) => (
                          <Badge key={v} variant="secondary" className="font-mono text-[11px]">{v}</Badge>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="badge" className="text-sm font-medium">Nombor Pekerja / Nombor Badge *</Label>
                <Input
                  id="badge"
                  value={badge}
                  onChange={(e) => setBadge(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  placeholder="cth. CS1234 / T012625 / 1011165"
                  required
                  autoComplete="off"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm font-medium">Nama Penuh *</Label>
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

              {!dup && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Adakah anda masih menggunakan loker ini? *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={stillUsing === true ? "default" : "outline"}
                      className="h-12 text-base"
                      onClick={() => setStillUsing(true)}
                      aria-pressed={stillUsing === true}
                    >
                      Ya
                    </Button>
                    <Button
                      type="button"
                      variant={stillUsing === false ? "default" : "outline"}
                      className="h-12 text-base"
                      onClick={() => setStillUsing(false)}
                      aria-pressed={stillUsing === false}
                    >
                      Tidak
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="contact" className="text-sm font-medium">Nombor Telefon *</Label>
                <Input
                  id="contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  placeholder="cth. 012-3456789"
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
                {loading ? "Menghantar…" : "Hantar"}
              </Button>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Maklumat anda hanya digunakan untuk kemas kini rekod loker dan tidak dikongsi secara umum.
                </span>
              </p>
            </form>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rajah Loker</CardTitle>
            <p className="text-xs text-muted-foreground">
              Gunakan rajah ini untuk mengenal pasti baris loker anda (A–F, dari atas ke bawah).
            </p>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg overflow-hidden border bg-white">
              <img
                src={lockerDiagram.url}
                alt="Rajah loker menunjukkan baris A hingga F dari atas ke bawah"
                className="w-full h-auto"
                loading="lazy"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
