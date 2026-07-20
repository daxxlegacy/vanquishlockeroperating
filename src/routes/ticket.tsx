import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Ticket, Send, ArrowLeft, User, Shield, Bell } from "lucide-react";
import { toast } from "sonner";
import {
  REQUEST_TYPE_LABEL,
  STATUS_LABEL,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support-requests";
import { formatDateTime } from "@/lib/format-date";
import { ReplyAttachment } from "@/components/support/ReplyAttachment";

const searchSchema = z.object({
  t: z.string().optional(),
  b: z.string().optional(),
});

export const Route = createFileRoute("/ticket")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Check ticket status" },
      { name: "description", content: "View updates and reply to your support ticket." },
    ],
  }),
  component: TicketPage,
});

type Reply = {
  id: string;
  author_role: "admin" | "user";
  author_name: string | null;
  message: string;
  attachment_path: string | null;
  created_at: string;
};
type TicketData = {
  id: string;
  ticket_number: string;
  created_at: string;
  updated_at: string;
  request_type: SupportRequestType;
  name: string;
  badge_number: string;
  locker_number: string | null;
  contact_number: string;
  message: string;
  status: SupportRequestStatus;
  replies: Reply[];
};

function TicketPage() {
  const { t: qt, b: qb } = Route.useSearch();
  const [ticket, setTicket] = useState(qt ?? "");
  const [badge, setBadge] = useState(qb ?? "");
  const [data, setData] = useState<TicketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied"
  );
  const lastAdminReplyIdRef = useRef<string | null>(null);

  const lookup = async (e?: React.FormEvent, opts?: { message?: string }) => {
    e?.preventDefault();
    if (opts?.message) setSending(true); else setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("support-ticket", {
        body: {
          action: opts?.message ? "reply" : "lookup",
          ticket_number: ticket.trim(),
          badge_number: badge.trim(),
          message: opts?.message,
        },
      });
      if (err || !res || (res as { error?: string }).error) {
        setError((res as { error?: string } | null)?.error ?? err?.message ?? "Ticket not found.");
        return;
      }
      setData((res as { ticket: TicketData }).ticket);
      if (opts?.message) setReply("");
    } catch {
      setError("Could not load ticket.");
    } finally {
      setLoading(false);
      setSending(false);
    }
  };

  // Auto-lookup if both query params present
  useEffect(() => {
    if (qt && qb && !data) {
      lookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track latest admin reply so we can detect new ones during polling
  useEffect(() => {
    if (!data) return;
    const lastAdmin = [...data.replies].reverse().find((r) => r.author_role === "admin");
    if (lastAdmin && lastAdminReplyIdRef.current === null) {
      lastAdminReplyIdRef.current = lastAdmin.id;
    }
  }, [data]);

  // Poll every 15s for new admin replies while ticket is open; notify on new ones
  useEffect(() => {
    if (!data) return;
    const tk = ticket.trim();
    const bd = badge.trim();
    if (!tk || !bd) return;

    const iv = setInterval(async () => {
      try {
        const { data: res } = await supabase.functions.invoke("support-ticket", {
          body: { action: "lookup", ticket_number: tk, badge_number: bd },
        });
        const fresh = (res as { ticket?: TicketData } | null)?.ticket;
        if (!fresh) return;
        const lastAdmin = [...fresh.replies].reverse().find((r) => r.author_role === "admin");
        const prevId = lastAdminReplyIdRef.current;
        if (lastAdmin && lastAdmin.id !== prevId && prevId !== null) {
          lastAdminReplyIdRef.current = lastAdmin.id;
          setData(fresh);
          const body = lastAdmin.message.slice(0, 140);
          toast.success("Admin replied to your ticket", { description: body });
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification(`Ticket ${fresh.ticket_number} — Admin replied`, {
                body,
                tag: `ticket-${fresh.id}`,
                icon: "/favicon.ico",
              });
            } catch { /* ignore */ }
          }
        } else {
          setData(fresh);
          if (lastAdmin && prevId === null) lastAdminReplyIdRef.current = lastAdmin.id;
        }
      } catch { /* ignore transient errors */ }
    }, 15000);

    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      toast.error("Notifications not supported on this device.");
      return;
    }
    try {
      const p = await Notification.requestPermission();
      setNotifPerm(p);
      if (p === "granted") {
        toast.success("Notifications enabled. Keep this page open to receive replies.");
      } else {
        toast.info("Notifications blocked. You can enable them in your browser settings.");
      }
    } catch {
      toast.error("Couldn't enable notifications.");
    }
  };

  const sendReply = () => {
    const m = reply.trim();
    if (!m) return;
    lookup(undefined, { message: m });
  };


  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <Link to="/find-locker" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Locker Inquiry
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Ticket className="h-4 w-4" /> Check ticket status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={lookup} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
              <div>
                <Label htmlFor="tk">Ticket number</Label>
                <Input id="tk" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="e.g. 00042" inputMode="numeric" />
              </div>
              <div>
                <Label htmlFor="bd">Badge number</Label>
                <Input id="bd" value={badge} onChange={(e) => setBadge(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={loading || !ticket.trim() || !badge.trim()}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "View"}
                </Button>
              </div>
            </form>
            {error && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {data && (
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base font-mono">{data.ticket_number}</CardTitle>
                <Badge variant="outline">{STATUS_LABEL[data.status]}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {REQUEST_TYPE_LABEL[data.request_type]} · submitted {formatDateTime(data.created_at)}
              </div>
              {notifPerm !== "granted" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={enableNotifications}
                  className="w-full sm:w-auto"
                >
                  <Bell className="h-4 w-4 mr-2" />
                  Get notified when admin replies
                </Button>
              ) : (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Bell className="h-3.5 w-3.5 text-primary" />
                  Notifications on — keep this page open to receive alerts.
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <Bubble
                role="user"
                name={data.name}
                text={data.message}
                time={data.created_at}
              />
              {data.replies.map((r) => (
                <Bubble
                  key={r.id}
                  role={r.author_role}
                  name={r.author_name ?? (r.author_role === "admin" ? "Admin office" : data.name)}
                  text={r.message}
                  time={r.created_at}
                  attachmentPath={r.attachment_path}
                  ticketNumber={data.ticket_number}
                  badgeNumber={data.badge_number}
                />
              ))}

              {data.status !== "resolved" ? (
                <div className="pt-2 border-t space-y-2">
                  <Label htmlFor="rp" className="text-sm">Reply to admin</Label>
                  <Textarea
                    id="rp"
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Add more details or respond to the admin…"
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={sendReply} disabled={sending || !reply.trim()}>
                      {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                      Send reply
                    </Button>
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertDescription>
                    This ticket is marked resolved. If you still need help, sending a reply will re-open it.
                  </AlertDescription>
                </Alert>
              )}

              {data.status === "resolved" && (
                <div className="pt-2 border-t space-y-2">
                  <Textarea
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply to re-open this ticket…"
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={sendReply} disabled={sending || !reply.trim()}>
                      {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                      Reply &amp; re-open
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Bubble({
  role, name, text, time, attachmentPath, ticketNumber, badgeNumber,
}: {
  role: "admin" | "user";
  name: string;
  text: string;
  time: string;
  attachmentPath?: string | null;
  ticketNumber?: string;
  badgeNumber?: string;
}) {
  const isAdmin = role === "admin";
  return (
    <div className={`flex ${isAdmin ? "" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isAdmin
            ? "bg-background border rounded-tl-sm"
            : "bg-primary text-primary-foreground rounded-tr-sm"
        }`}
      >
        <div className={`flex items-center gap-1.5 text-xs mb-0.5 ${isAdmin ? "text-muted-foreground" : "opacity-80"}`}>
          {isAdmin ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
          {name} · {formatDateTime(time)}
        </div>
        {text}
        {attachmentPath && (
          <ReplyAttachment
            path={attachmentPath}
            mode="public"
            ticketNumber={ticketNumber}
            badgeNumber={badgeNumber}
          />
        )}
      </div>
    </div>
  );
}
