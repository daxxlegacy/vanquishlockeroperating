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
import lockerDiagram from "@/assets/locker-diagram.png.asset.json";

export const Route = createFileRoute("/locker-identity-update")({
  head: () => ({
    meta: [
      { title: "Locker Identity Update / Kemas Kini Identiti Loker" },
      { name: "description", content: "Register the identity of the current locker holder. / Daftarkan identiti pemilik loker semasa." },
    ],
  }),
  component: LockerIdentityUpdatePage,
});

const lockerRe = /^([0-9]+[A-Z]+|[A-Z]+[0-9]+)$/;

const ERR = {
  lockerFormat: "Locker number must be digits+letter (e.g. 1411E) or letters+digits (e.g. B08). / Nombor loker mesti digit+huruf (cth. 1411E) atau huruf+digit (cth. B08).",
  badge: "Please enter your employee / badge number. / Sila masukkan nombor pekerja / badge anda.",
  name: "Please enter your full name. / Sila masukkan nama penuh anda.",
  stillUsing: "Please answer whether you are still using this locker. / Sila jawab sama ada anda masih menggunakan loker ini.",
  contact: "Please enter a valid phone number. / Sila masukkan nombor telefon yang sah.",
  generic: "Couldn't submit right now — please try again shortly. / Gagal menghantar — sila cuba lagi sebentar.",
  rate: "Too many submissions. Please try again in a few minutes. / Terlalu banyak penghantaran. Sila cuba lagi dalam beberapa minit.",
};

function BiLabel({ en, bm }: { en: string; bm: string }) {
  return (
    <span className="block">
      <span className="block text-sm font-medium">{en}</span>
      <span className="block text-xs text-muted-foreground italic">{bm}</span>
    </span>
  );
}

function LockerIdentityUpdatePage() {
  const [lockerNumber, setLockerNumber] = useState("");
  const [badge, setBadge] = useState("");
  const [fullName, setFullName] = useState("");
  const [stillUsing, setStillUsing] = useState<null | boolean>(null);
  const [contact, setContact] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

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
      locker: z.string().regex(lockerRe, ERR.lockerFormat),
      badge: z.string().trim().min(1, ERR.badge).max(60),
      name: z.string().trim().min(1, ERR.name).max(120),
      still: z.boolean({ invalid_type_error: ERR.stillUsing, required_error: ERR.stillUsing }),
      contact: z.string().trim().min(5, ERR.contact).max(40),
    });
    const parsed = schema.safeParse({
      locker: lockerNumber.trim().toUpperCase(),
      badge,
      name: fullName,
      still: stillUsing,
      contact,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ERR.generic);
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.functions.invoke("submit-locker-identity-claim", {
        body: {
          claim_type: "unknown_owner",
          locker_number: parsed.data.locker,
          badge_number: parsed.data.badge.trim(),
          full_name: parsed.data.name.trim(),
          contact_number: parsed.data.contact.trim(),
          location: "",
          still_using: parsed.data.still,
          other_locker_numbers: [],
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
                <CheckCircle2 className="h-5 w-5 text-primary" /> Response recorded / Respons direkodkan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed">
                Thank you, your response has been recorded. Reference #{successId}. Please remove the notice sticker from your locker now that you've registered.
              </p>
              <p className="text-sm leading-relaxed italic text-muted-foreground">
                Terima kasih, respons anda telah direkodkan. Rujukan #{successId}. Sila tanggalkan pelekat notis dari loker anda selepas pendaftaran.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-24 sm:pb-10">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Locker Identity Update</h1>
          <p className="text-base font-medium italic text-muted-foreground">Kemas Kini Identiti Loker</p>
          <p className="text-sm text-muted-foreground mt-2">
            Please fill in your locker information accurately. This information is required for internal records.
          </p>
          <p className="text-xs text-muted-foreground italic mt-1">
            Sila isikan maklumat loker anda dengan tepat. Maklumat ini diperlukan untuk rekod dalaman.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="h-4 w-4" /> Locker Identity Update
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              * Indicates required question / Menunjukkan soalan wajib
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="locker">
                  <BiLabel en="Locker Number *" bm="Nombor Loker *" />
                </Label>
                <Input
                  id="locker"
                  value={lockerNumber}
                  onChange={(e) => setLockerNumber(e.target.value.toUpperCase())}
                  onFocus={scrollFocusIntoView}
                  placeholder="e.g. 1411E"
                  required
                  autoComplete="off"
                  inputMode="text"
                  className="h-12 text-base"
                />
                <p className="text-xs text-muted-foreground">
                  Format: digits followed by one uppercase letter (e.g. 1411E)
                  <br />
                  <span className="italic">Format: digit diikuti satu huruf besar (cth. 1411E)</span>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="badge">
                  <BiLabel en="Employee Number / Badge Number *" bm="Nombor Pekerja / Nombor Badge *" />
                </Label>
                <Input
                  id="badge"
                  value={badge}
                  onChange={(e) => setBadge(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  placeholder="e.g. CS1234 / T012625 / 1011165"
                  required
                  autoComplete="off"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name">
                  <BiLabel en="Full Name *" bm="Nama Penuh *" />
                </Label>
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
                <Label>
                  <BiLabel
                    en="Are you still using this locker? *"
                    bm="Adakah anda masih menggunakan loker ini? *"
                  />
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={stillUsing === true ? "default" : "outline"}
                    className="h-12 text-base flex-col leading-tight"
                    onClick={() => setStillUsing(true)}
                    aria-pressed={stillUsing === true}
                  >
                    <span>Yes</span>
                    <span className="text-xs opacity-80 italic">Ya</span>
                  </Button>
                  <Button
                    type="button"
                    variant={stillUsing === false ? "default" : "outline"}
                    className="h-12 text-base flex-col leading-tight"
                    onClick={() => setStillUsing(false)}
                    aria-pressed={stillUsing === false}
                  >
                    <span>No</span>
                    <span className="text-xs opacity-80 italic">Tidak</span>
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact">
                  <BiLabel en="Phone Number *" bm="Nombor Telefon *" />
                </Label>
                <Input
                  id="contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  placeholder="e.g. 012-3456789"
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
                {loading ? "Submitting… / Menghantar…" : "Submit / Hantar"}
              </Button>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Your information is used only for locker record updates and is not shared publicly.
                  <br />
                  <span className="italic">
                    Maklumat anda hanya digunakan untuk kemas kini rekod loker dan tidak dikongsi secara umum.
                  </span>
                </span>
              </p>
            </form>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Locker Diagram <span className="text-muted-foreground italic font-normal">/ Rajah Loker</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Use this diagram to identify your locker row (A–F, top to bottom).
              <br />
              <span className="italic">
                Gunakan rajah ini untuk mengenal pasti baris loker anda (A–F, dari atas ke bawah).
              </span>
            </p>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg overflow-hidden border bg-white">
              <img
                src={lockerDiagram.url}
                alt="Locker diagram showing rows A through F from top to bottom / Rajah loker menunjukkan baris A hingga F dari atas ke bawah"
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
