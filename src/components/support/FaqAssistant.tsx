// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Send, MessageSquare, Bot, User } from "lucide-react";
import { SupportRequestForm } from "./SupportRequestForm";
import { t, type Lang } from "@/lib/i18n-find-locker";

type Turn = { question: string; answer: string };

export function FaqAssistant({ lang = "en" }: { lang?: Lang }) {
  const tr = t[lang];
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [escalateFor, setEscalateFor] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setQuestion("");
    try {
      const { data, error: err } = await supabase.functions.invoke("faq-assistant", {
        body: { question: q },
      });
      if (err || !data || (data as { error?: string }).error) {
        const msg = (data as { error?: string } | null)?.error ?? err?.message ?? "";
        setError(msg || tr.faq.unavailable);
        setQuestion(q);
        return;
      }
      const answer = (data as { answer: string }).answer;
      setTurns((prev) => [...prev, { question: q, answer }]);
    } catch {
      setError(tr.faq.unavailable);
      setQuestion(q);
    } finally {
      setBusy(false);
    }
  };

  const scrollFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" />
        {tr.faq.ask}
      </div>

      {(turns.length > 0 || busy) && (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 -mx-1 px-1">
          {turns.map((turn, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-end">
                <div className="rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2 text-base max-w-[85%] break-words">
                  <div className="flex items-center gap-1.5 text-xs opacity-80 mb-0.5">
                    <User className="h-3 w-3" /> {tr.faq.you}
                  </div>
                  {turn.question}
                </div>
              </div>
              <div className="flex">
                <div className="rounded-2xl rounded-tl-sm bg-background border px-3 py-2 text-base max-w-[85%] whitespace-pre-wrap break-words">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                    <Bot className="h-3 w-3" /> {tr.faq.assistant}
                  </div>
                  {turn.answer}
                </div>
              </div>
              <div className="flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => setEscalateFor(turn.question)}
                >
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                  {tr.faq.notHelpful}
                </Button>
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex">
              <div className="rounded-2xl rounded-tl-sm bg-background border px-3 py-2 max-w-[85%]">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Bot className="h-3 w-3" /> {tr.faq.assistant}
                </div>
                <TypingDots aria-label={tr.faq.thinking} />
              </div>
            </div>
          )}

          <div ref={listEndRef} />
        </div>
      )}

      {escalateFor && (
        <div className="rounded-lg border bg-background p-3 space-y-2">
          <div className="text-sm font-medium">{tr.faq.escalateHeading}</div>
          <SupportRequestForm
            lang={lang}
            requestType="other"
            showLockerField
            defaultMessage={escalateFor}
            messageLabel={tr.faq.yourQuestion}
            messagePlaceholder={tr.faq.moreDetail}
            submitLabel={tr.faq.sendHuman}
          />
          <div>
            <Button variant="ghost" size="sm" onClick={() => setEscalateFor(null)}>
              {tr.faq.cancel}
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={ask} className="sticky bottom-0 flex gap-2 bg-muted/30 pt-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onFocus={scrollFocus}
          placeholder={tr.faq.placeholder}
          maxLength={1000}
          disabled={busy}
          inputMode="text"
          className="h-12 text-base"
        />
        <Button
          type="submit"
          className="h-12 w-12 shrink-0 p-0"
          disabled={busy || !question.trim()}
          aria-label="Send"
        >
          <Send className="h-5 w-5" />
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        {tr.faq.disclaimer}
      </p>
    </div>
  );
}

function TypingDots({ "aria-label": ariaLabel }: { "aria-label"?: string }) {
  return (
    <div className="flex items-center gap-1 h-5" aria-label={ariaLabel}>
      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" />
    </div>
  );
}
