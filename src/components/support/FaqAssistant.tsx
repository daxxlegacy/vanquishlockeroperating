import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Sparkles, Send, MessageSquare, Bot, User } from "lucide-react";
import { SupportRequestForm } from "./SupportRequestForm";

type Turn = { question: string; answer: string };

export function FaqAssistant() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [escalateFor, setEscalateFor] = useState<string | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("faq-assistant", {
        body: { question: q },
      });
      if (err || !data || (data as { error?: string }).error) {
        const msg = (data as { error?: string } | null)?.error ?? err?.message ?? "";
        setError(msg || "The assistant is unavailable right now.");
        return;
      }
      const answer = (data as { answer: string }).answer;
      setTurns((prev) => [...prev, { question: q, answer }]);
      setQuestion("");
    } catch {
      setError("The assistant is unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" />
        Ask the assistant
      </div>

      {turns.length > 0 && (
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="flex gap-2 justify-end">
                <div className="rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2 text-sm max-w-[85%]">
                  <div className="flex items-center gap-1.5 text-xs opacity-80 mb-0.5">
                    <User className="h-3 w-3" /> You
                  </div>
                  {t.question}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="rounded-2xl rounded-tl-sm bg-background border px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                    <Bot className="h-3 w-3" /> Assistant
                  </div>
                  {t.answer}
                </div>
              </div>
              <div className="flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setEscalateFor(t.question)}
                >
                  <MessageSquare className="h-3 w-3 mr-1" />
                  Not helpful? Talk to a human
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {escalateFor && (
        <div className="rounded-lg border bg-background p-3 space-y-2">
          <div className="text-sm font-medium">Send this to a human</div>
          <SupportRequestForm
            requestType="other"
            showLockerField
            defaultMessage={escalateFor}
            messageLabel="Your question"
            messagePlaceholder="Add more detail if needed…"
            submitLabel="Send to support"
          />
          <div>
            <Button variant="ghost" size="sm" onClick={() => setEscalateFor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={ask} className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How do I request a transfer?"
          maxLength={1000}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !question.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        This is an automated assistant and cannot access your personal locker details.
      </p>
    </div>
  );
}
