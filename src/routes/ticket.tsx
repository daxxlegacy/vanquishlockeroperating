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
import { Loader2, Ticket, Send, ArrowLeft, User, Shield, Bell, Search, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  REQUEST_TYPE_LABEL,
  STATUS_LABEL,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support-requests";
import { formatDateTime } from "@/lib/format-date";
import { ReplyAttachment } from "@/components/support/ReplyAttachment";
import { ImagePreviewModal, type ImagePreviewItem } from "@/components/ImagePreviewModal";
import { signTicketAttachment } from "@/lib/ticket-attachment";
import { useLang, t as i18n } from "@/lib/i18n-find-locker";


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

type BadgeTicketSummary = {
  ticket_number: string;
  request_type: SupportRequestType;
  status: SupportRequestStatus;
  created_at: string;
};

function TicketPage() {
  const [lang] = useLang();
  const tt = i18n[lang].ticket;
  const { t: qt, b: qb } = Route.useSearch();
  const [badge, setBadge] = useState(qb ?? "");
  const [data, setData] = useState<TicketData | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [results, setResults] = useState<BadgeTicketSummary[] | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied"
  );

  const currentTicketRef = useRef<string | null>(null);
  const lastAdminReplyIdRef = useRef<string | null>(null);

  const openTicket = async (
    ticketNumber: string,
    badgeNumber: string,
    opts?: { message?: string },
  ) => {
    if (opts?.message) setSending(true); else setOpenLoading(true);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("support-ticket", {
        body: {
          action: opts?.message ? "reply" : "lookup",
          ticket_number: ticketNumber,
          badge_number: badgeNumber,
          message: opts?.message,
        },
      });
      if (err || !res || (res as { error?: string }).error) {
        toast.error((res as { error?: string } | null)?.error ?? err?.message ?? "Ticket not found.");
        return;
      }
      const ticket = (res as { ticket: TicketData }).ticket;
      currentTicketRef.current = ticket.ticket_number;
      setData(ticket);
      if (opts?.message) setReply("");
    } catch {
      toast.error("Could not load ticket.");
    } finally {
      setOpenLoading(false);
      setSending(false);
    }
  };

  const lookupByBadge = async (
    e?: React.FormEvent,
    opts?: { badge?: string; silent?: boolean },
  ) => {
    e?.preventDefault();
    const b = (opts?.badge ?? badge).trim();
    if (!b) return;
    if (!opts?.silent) setListLoading(true);
    setListError(null);
    setResults(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("support-ticket", {
        body: { action: "list_by_badge", badge_number: b },
      });
      if (err || !res || (res as { error?: string }).error) {
        setListError((res as { error?: string } | null)?.error ?? err?.message ?? tt.noneFound);
        return;
      }
      setResults((res as { tickets: BadgeTicketSummary[] }).tickets);
    } catch {
      setListError(tt.noneFound);
    } finally {
      setListLoading(false);
    }
  };

  // Auto-run on mount from query params. Backward compat: ?t=&b= opens that
  // specific ticket directly; ?b= alone runs the badge list.
  useEffect(() => {
    const b = (qb ?? "").trim();
    if (qt && b) {
      void openTicket(qt.trim(), b);
    } else if (b) {
      void lookupByBadge(undefined, { badge: b });
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
    const tk = data.ticket_number;
    const bd = data.badge_number;
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
    if (!m || !data) return;
    void openTicket(data.ticket_number, data.badge_number, { message: m });
  };

  const backToList = () => {
    setData(null);
    lastAdminReplyIdRef.current = null;
    currentTicketRef.current = null;
    // Refresh the list so status/updated_at reflect any changes.
    void lookupByBadge(undefined, { silent: true });
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
              <Ticket className="h-4 w-4" /> {i18n[lang].helpMenu.ticket.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{tt.intro}</p>
            <form onSubmit={lookupByBadge} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <div>
                <Label htmlFor="bd">{tt.badge}</Label>
                <Input
                  id="bd"
                  value={badge}
                  onChange={(e) => setBadge(e.target.value)}
                  autoComplete="off"
                  inputMode="text"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={listLoading || !badge.trim()}>
                  {listLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <><Search className="h-4 w-4 mr-1" /> {tt.lookupByBadgeSubmit}</>
                  )}
                </Button>
              </div>
            </form>
            {listError && (
              <Alert variant="destructive">
                <AlertDescription>{listError}</AlertDescription>
              </Alert>
            )}
            {results && results.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{tt.lookupByBadgeHeading(results.length)}</div>
                <ul className="divide-y rounded-md border">
                  {results.map((r) => {
                    const isActive = data?.ticket_number === r.ticket_number;
                    return (
                      <li key={r.ticket_number}>
                        <button
                          type="button"
                          onClick={() => openTicket(r.ticket_number, badge.trim())}
                          disabled={openLoading}
                          className={`w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-accent transition-colors ${
                            isActive ? "bg-accent/60" : ""
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-medium">#{r.ticket_number}</span>
                              <Badge variant="outline" className="text-xs">{STATUS_LABEL[r.status]}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              {REQUEST_TYPE_LABEL[r.request_type]} · {tt.submittedOn} {formatDateTime(r.created_at)}
                            </div>
                          </div>
                          {openLoading && isActive ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {data && (
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {results && results.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={backToList} className="h-8 px-2">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  )}
                  <CardTitle className="text-base font-mono">{data.ticket_number}</CardTitle>
                </div>
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
              <TicketConversation data={data} />


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

function TicketConversation({ data }: { data: TicketData }) {
  const attachments = data.replies.filter((r) => !!r.attachment_path);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const items: ImagePreviewItem[] = attachments.map((r) => ({
    key: r.id,
    alt: `Attachment from ${r.author_name ?? r.author_role}`,
    sign: () =>
      signTicketAttachment(r.attachment_path!, {
        mode: "public",
        ticketNumber: data.ticket_number,
        badgeNumber: data.badge_number,
      }),
  }));

  const openAttachment = (replyId: string) => {
    const i = attachments.findIndex((a) => a.id === replyId);
    if (i < 0) return;
    setPreviewIndex(i);
    setPreviewOpen(true);
  };

  return (
    <>
      <Bubble role="user" name={data.name} text={data.message} time={data.created_at} />
      {data.replies.map((r) => (
        <Bubble
          key={r.id}
          role={r.author_role}
          name={r.author_name ?? (r.author_role === "admin" ? "Admin" : data.name)}
          text={r.message}
          time={r.created_at}
          attachmentPath={r.attachment_path}
          ticketNumber={data.ticket_number}
          badgeNumber={data.badge_number}
          onOpenAttachment={() => openAttachment(r.id)}
        />
      ))}
      <ImagePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        items={items}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
      />
    </>
  );
}

function Bubble({
  role, name, text, time, attachmentPath, ticketNumber, badgeNumber, onOpenAttachment,
}: {
  role: "user" | "admin";
  name: string;
  text: string;
  time: string;
  attachmentPath?: string | null;
  ticketNumber?: string;
  badgeNumber?: string;
  onOpenAttachment?: () => void;
}) {
  const isAdmin = role === "admin";
  return (
    <div className={`flex gap-2 ${isAdmin ? "" : "flex-row-reverse"}`}>
      <div className={`shrink-0 h-8 w-8 rounded-full grid place-items-center text-white ${isAdmin ? "bg-primary" : "bg-muted-foreground"}`}>
        {isAdmin ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 ${isAdmin ? "bg-primary/10" : "bg-muted"}`}>
        <div className="text-xs text-muted-foreground mb-0.5">{name} · {formatDateTime(time)}</div>
        <div className="text-sm whitespace-pre-wrap">{text}</div>
        {attachmentPath ? (
          <ReplyAttachment
            path={attachmentPath}
            mode="public"
            ticketNumber={ticketNumber}
            badgeNumber={badgeNumber}
            onOpen={onOpenAttachment}
          />
        ) : null}
      </div>
    </div>
  );
}
