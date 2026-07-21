import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpCircle, MessageSquare, Ticket, ChevronLeft } from "lucide-react";
import { SupportRequestForm } from "./SupportRequestForm";
import { FaqAssistant } from "./FaqAssistant";
import { t, type Lang } from "@/lib/i18n-find-locker";

type Panel = "menu" | "other" | "ticket";


export function HelpMenu({
  onPickInquiry,
  lang = "en",
}: {
  onPickInquiry: () => void;
  lang?: Lang;
}) {
  const tr = t[lang];
  const [panel, setPanel] = useState<Panel>("menu");
  const [tb, setTb] = useState("");
  const navigate = useNavigate();

  const scrollFocusIntoView = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  };

  const back = () => setPanel("menu");

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <HelpCircle className="h-4 w-4" /> {tr.helpMenu.heading}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2">
          <MenuButton
            active={panel === "other"}
            onClick={() => setPanel("other")}
            icon={<MessageSquare className="h-5 w-5" />}
            label={tr.helpMenu.other.label}
            sub={tr.helpMenu.other.sub}
          />
          <MenuButton
            active={panel === "ticket"}
            onClick={() => setPanel("ticket")}
            icon={<Ticket className="h-5 w-5" />}
            label={tr.helpMenu.ticket.label}
            sub={tr.helpMenu.ticket.sub}
          />
        </div>


        {panel !== "menu" && (
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground active:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> {tr.helpMenu.back}
          </button>
        )}

        {panel === "ticket" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm text-muted-foreground">{tr.ticket.intro}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const b = tb.trim();
                if (!b) return;
                navigate({ to: "/ticket", search: { b } });
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="tk-badge" className="text-sm">{tr.ticket.badge}</Label>
                <Input
                  id="tk-badge"
                  value={tb}
                  onChange={(e) => setTb(e.target.value)}
                  onFocus={scrollFocusIntoView}
                  autoComplete="off"
                  inputMode="text"
                  className="h-12 text-base"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-base"
                disabled={!tb.trim()}
              >
                <Ticket className="h-4 w-4 mr-2" /> {tr.ticket.lookupByBadgeSubmit}
              </Button>
            </form>
          </div>
        )}




        {panel === "other" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm text-muted-foreground">{tr.otherPanel.intro}</p>
            <FaqAssistant lang={lang} />
            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-2">{tr.otherPanel.orHuman}</p>
              <SupportRequestForm
                lang={lang}
                requestType="other"
                showLockerField
                messageLabel={tr.otherPanel.messageLabel}
                messagePlaceholder={tr.otherPanel.messagePlaceholder}
                submitLabel={tr.otherPanel.submitLabel}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MenuButton({
  active, onClick, icon, label, sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-h-[56px] text-left rounded-lg border p-3 transition-colors active:scale-[0.99] ${
        active
          ? "border-primary bg-primary/5"
          : "border-border bg-background"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{label}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>
        </div>
      </div>
    </button>
  );
}
