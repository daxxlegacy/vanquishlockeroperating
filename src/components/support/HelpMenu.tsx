import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRightLeft, HelpCircle, MessageSquare, Search, Ticket, ChevronLeft } from "lucide-react";
import { SupportRequestForm } from "./SupportRequestForm";
import { FaqAssistant } from "./FaqAssistant";

type Panel = "menu" | "transfer" | "cant_find" | "cant_find_form" | "other" | "ticket";

export function HelpMenu({ onPickFind }: { onPickFind: () => void }) {
  const [panel, setPanel] = useState<Panel>("menu");
  const [tk, setTk] = useState("");
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
          <HelpCircle className="h-4 w-4" /> How can we help you?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Menu — full-width stacked buttons, min 48px tap height */}
        <div className="flex flex-col gap-2">
          <MenuButton
            active={panel === "menu"}
            onClick={() => { setPanel("menu"); onPickFind(); }}
            icon={<Search className="h-5 w-5" />}
            label="Find my locker"
            sub="Use the form above"
          />
          <MenuButton
            active={panel === "transfer"}
            onClick={() => setPanel("transfer")}
            icon={<ArrowRightLeft className="h-5 w-5" />}
            label="I want to transfer my locker"
            sub="Request a transfer"
          />
          <MenuButton
            active={panel === "cant_find" || panel === "cant_find_form"}
            onClick={() => setPanel("cant_find")}
            icon={<HelpCircle className="h-5 w-5" />}
            label="I can't find my locker number"
            sub="Get help locating it"
          />
          <MenuButton
            active={panel === "other"}
            onClick={() => setPanel("other")}
            icon={<MessageSquare className="h-5 w-5" />}
            label="Something else"
            sub="Ask assistant or contact support"
          />
          <MenuButton
            active={panel === "ticket"}
            onClick={() => setPanel("ticket")}
            icon={<Ticket className="h-5 w-5" />}
            label="Check ticket status"
            sub="View replies from admin"
          />
        </div>

        {panel !== "menu" && (
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground active:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Back to menu
          </button>
        )}

        {panel === "ticket" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter your ticket number and badge number to view updates or reply.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const t = tk.trim();
                const b = tb.trim();
                if (!t || !b) return;
                navigate({ to: "/ticket", search: { t, b } });
              }}
              className="space-y-3"
            >
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tk-num" className="text-sm">Ticket number</Label>
                  <Input
                    id="tk-num"
                    value={tk}
                    onChange={(e) => setTk(e.target.value)}
                    onFocus={scrollFocusIntoView}
                    placeholder="e.g. 00042"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={5}
                    autoComplete="off"
                    className="h-12 text-base"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tk-badge" className="text-sm">Badge number</Label>
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
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-base"
                disabled={!tk.trim() || !tb.trim()}
              >
                <Ticket className="h-4 w-4 mr-2" /> View my ticket
              </Button>
            </form>
          </div>
        )}

        {panel === "transfer" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm">
              Locker transfers must be approved by the admin office. Please submit your details
              below and we'll process it within <strong>1 business day</strong>.
            </p>
            <SupportRequestForm
              requestType="transfer_locker"
              showLockerField
              messageLabel="Reason for transfer"
              messagePlaceholder="e.g. moved to a different work location, current locker too far…"
              submitLabel="Submit transfer request"
            />
          </div>
        )}

        {panel === "cant_find" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="space-y-2 text-sm">
              <p className="font-medium">Try these first:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Check your intake confirmation email or paper slip.</li>
                <li>Ask your supervisor or HR — they usually have the assignment list.</li>
                <li>Use the badge lookup at the top of this page.</li>
              </ul>
            </div>
            <Button
              variant="outline"
              className="w-full h-12 text-base"
              onClick={() => setPanel("cant_find_form")}
            >
              Still can't find it — contact us
            </Button>
          </div>
        )}

        {panel === "cant_find_form" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              We'll help you locate your locker. Please share your details so we can get back to you.
            </p>
            <SupportRequestForm
              requestType="cant_find_locker"
              showLockerField={false}
              defaultMessage="I can't find my locker number."
              messageLabel="Extra details (optional)"
              messagePlaceholder="Anything that would help us find your assignment…"
              submitLabel="Send to support"
            />
          </div>
        )}

        {panel === "other" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask our automated assistant, or send your question straight to a human below.
            </p>
            <FaqAssistant />
            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-2">
                Prefer to talk to our team directly?
              </p>
              <SupportRequestForm
                requestType="other"
                showLockerField
                messageLabel="How can we help?"
                messagePlaceholder="Type your question or request…"
                submitLabel="Talk to a human"
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
