import { createFileRoute } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  LifeBuoy,
  ArrowRightLeft,
  HelpCircle,
  MessageSquare,
  Phone,
  User,
  Hash,
  Clock,
  Send,
  Shield,
  Loader2,
  Ticket,
  Trash2,
  QrCode,
  ClipboardCheck,
} from "lucide-react";
import { FindLockerPanel } from "@/components/operations/FindLockerPanel";
import { IdentityUpdatePanel } from "@/components/support/IdentityUpdatePanel";
import { toast } from "sonner";
import {
  REQUEST_TYPE_LABEL,
  STATUS_LABEL,
  type SupportRequest,
  type SupportRequestReply,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support-requests";
import { formatDateTime } from "@/lib/format-date";

export const Route = createFileRoute("/support-requests")({
  head: () => ({
    meta: [
      { title: "Support Requests — LockerOps" },
      { name: "description", content: "Review, reply to, and resolve support requests from Locker Inquiry." },
    ],
  }),
  component: () => (
    <PageGuard permission={["page_support_requests", "manage_support_requests"]}>
      <SupportRequestsPage />
    </PageGuard>
  ),
});

function SupportRequestsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SupportRequest[] | null>(null);
  const [filter, setFilter] = useState<SupportRequestStatus | "all">("new");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setSelected(new Set());
  }, [filter]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              order: (
                col: string,
                o: { ascending: boolean },
              ) => Promise<{ data: SupportRequest[] | null; error: { message: string } | null }>;
            };
          };
        }
      )
        .from("support_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setRows([]);
      } else {
        setRows(data ?? []);
      }
    };

    load();

    const channel = supabase
      .channel("support-requests-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_requests" }, () => {
        load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_request_replies" }, () => {
        load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { new: 0, in_progress: 0, resolved: 0, all: 0 };
    for (const r of rows ?? []) {
      c.all++;
      c[r.status]++;
    }
    return c;
  }, [rows]);

  const updateStatus = async (id: string, status: SupportRequestStatus) => {
    const patch =
      status === "resolved"
        ? { status, resolved_by: user?.id ?? null, resolved_at: new Date().toISOString() }
        : { status, resolved_by: null, resolved_at: null };
    const { error } = await supabase.from("support_requests").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success(`Marked as ${STATUS_LABEL[status].toLowerCase()}`);
  };

  const selectableIds = useMemo(() => filtered.filter((r) => r.status === "resolved").map((r) => r.id), [filtered]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleOne = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAll = (on: boolean) => {
    setSelected(on ? new Set(selectableIds) : new Set());
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    const { error } = await supabase.from("support_requests").delete().in("id", ids);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Deleted ${ids.length} ticket${ids.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    setRows((prev) => (prev ? prev.filter((r) => !selected.has(r.id)) : prev));
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <LifeBuoy className="h-6 w-6 text-primary" />
          <div>
            <h1 className="font-display text-3xl font-bold">Support Requests</h1>
            <p className="text-muted-foreground text-sm">Requests submitted from the Locker Inquiry page.</p>
          </div>
        </div>

        <Tabs defaultValue="requests" className="mb-6">
          <TabsList>
            <TabsTrigger value="requests" className="gap-1.5">
              <LifeBuoy className="h-4 w-4" /> Requests
            </TabsTrigger>
            <TabsTrigger value="find-locker-qr" className="gap-1.5">
              <QrCode className="h-4 w-4" /> Locker Inquiry QR
            </TabsTrigger>
            <TabsTrigger value="identity-update" className="gap-1.5">
              <ClipboardCheck className="h-4 w-4" /> Identity Update
            </TabsTrigger>
          </TabsList>

          <TabsContent value="requests" className="mt-4">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as SupportRequestStatus | "all")}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="new">New{counts.new > 0 ? ` (${counts.new})` : ""}</TabsTrigger>
                <TabsTrigger value="in_progress">
                  In progress{counts.in_progress > 0 ? ` (${counts.in_progress})` : ""}
                </TabsTrigger>
                <TabsTrigger value="resolved">Resolved{counts.resolved > 0 ? ` (${counts.resolved})` : ""}</TabsTrigger>
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              </TabsList>

              <TabsContent value={filter} className="mt-4 space-y-3">
                {!rows ? (
                  <Skeleton className="h-40 w-full" />
                ) : filtered.length === 0 ? (
                  <Card className="p-10 text-center text-muted-foreground">
                    No {filter === "all" ? "" : STATUS_LABEL[filter as SupportRequestStatus].toLowerCase()} requests.
                  </Card>
                ) : (
                  <>
                    {selectableIds.length > 0 && (
                      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(v === true)} />
                          <span>
                            Select all resolved ({selectableIds.length})
                            {selected.size > 0 ? ` · ${selected.size} selected` : ""}
                          </span>
                        </label>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive" disabled={selected.size === 0 || deleting}>
                              {deleting ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 mr-1" />
                              )}
                              Delete selected
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete {selected.size} resolved ticket{selected.size === 1 ? "" : "s"}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently removes the tickets and all their replies. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={deleteSelected}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                    {filtered.map((r) => (
                      <SupportCard
                        key={r.id}
                        row={r}
                        onUpdate={updateStatus}
                        selectable={r.status === "resolved"}
                        selected={selected.has(r.id)}
                        onSelectedChange={(on) => toggleOne(r.id, on)}
                      />
                    ))}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="find-locker-qr" className="mt-4">
            <FindLockerPanel />
          </TabsContent>

          <TabsContent value="identity-update" className="mt-4">
            <IdentityUpdatePanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

const TYPE_ICON: Record<SupportRequestType, React.ComponentType<{ className?: string }>> = {
  transfer_locker: ArrowRightLeft,
  cant_find_locker: HelpCircle,
  other: MessageSquare,
};

const STATUS_STYLE: Record<SupportRequestStatus, string> = {
  new: "bg-primary/15 text-primary border-primary/30",
  in_progress: "bg-warning/15 text-warning-foreground border-warning/40",
  resolved: "bg-success/15 text-success border-success/40",
};

function SupportCard({
  row,
  onUpdate,
  selectable,
  selected,
  onSelectedChange,
}: {
  row: SupportRequest;
  onUpdate: (id: string, status: SupportRequestStatus) => void | Promise<void>;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (on: boolean) => void;
}) {
  const Icon = TYPE_ICON[row.request_type];
  const created = new Date(row.created_at);
  const { user } = useAuth();
  const [replies, setReplies] = useState<SupportRequestReply[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const loadReplies = async () => {
    const { data, error } = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              col: string,
              v: string,
            ) => {
              order: (
                col: string,
                o: { ascending: boolean },
              ) => Promise<{ data: SupportRequestReply[] | null; error: { message: string } | null }>;
            };
          };
        };
      }
    )
      .from("support_request_replies")
      .select("*")
      .eq("request_id", row.id)
      .order("created_at", { ascending: true });
    if (!error) setReplies(data ?? []);
  };

  useEffect(() => {
    if (expanded && replies === null) loadReplies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const sendReply = async () => {
    const m = reply.trim();
    if (!m) return;
    setSending(true);
    const { error } = await supabase.from("support_request_replies").insert({
      request_id: row.id,
      author_role: "admin",
      author_id: user?.id ?? null,
      author_name: user?.email ?? "Admin",
      message: m,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReply("");
    toast.success("Reply sent");
    loadReplies();
    if (row.status === "new") onUpdate(row.id, "in_progress");
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {selectable && (
            <Checkbox
              checked={!!selected}
              onCheckedChange={(v) => onSelectedChange?.(v === true)}
              aria-label="Select ticket for deletion"
            />
          )}
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-display font-bold text-lg truncate">{REQUEST_TYPE_LABEL[row.request_type]}</span>
          <Badge variant="outline" className="font-mono">
            <Ticket className="h-3 w-3 mr-1" />
            {row.ticket_number}
          </Badge>
          <Badge variant="outline" className={STATUS_STYLE[row.status]}>
            {STATUS_LABEL[row.status]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> {formatDateTime(created)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Name" value={row.name} />
        <InfoRow icon={<Hash className="h-3.5 w-3.5" />} label="Badge" value={row.badge_number} mono />
        <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Contact" value={row.contact_number} mono />
        <InfoRow icon={<Hash className="h-3.5 w-3.5" />} label="Locker" value={row.locker_number ?? "—"} mono />
      </div>

      <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{row.message}</div>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conversation</div>
          {replies === null ? (
            <Skeleton className="h-16 w-full" />
          ) : replies.length === 0 ? (
            <p className="text-xs text-muted-foreground">No replies yet.</p>
          ) : (
            <div className="space-y-2">
              {replies.map((r) => (
                <div
                  key={r.id}
                  className={`rounded-lg border p-2.5 text-sm ${
                    r.author_role === "admin" ? "bg-primary/5 border-primary/20" : "bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    {r.author_role === "admin" ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    <span className="font-medium">
                      {r.author_role === "admin" ? "Admin" : "User"}
                      {r.author_name ? ` · ${r.author_name}` : ""}
                    </span>
                    <span>· {formatDateTime(r.created_at)}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{r.message}</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Textarea
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Write a reply — the user will see this when they check their ticket status."
              maxLength={4000}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={sendReply} disabled={sending || !reply.trim()}>
                {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                Send reply
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2 flex-wrap justify-end">
        <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
          <MessageSquare className="h-3.5 w-3.5 mr-1" />
          {expanded ? "Hide replies" : "Replies"}
        </Button>
        {row.status !== "in_progress" && row.status !== "resolved" && (
          <Button size="sm" variant="secondary" onClick={() => onUpdate(row.id, "in_progress")}>
            Mark in progress
          </Button>
        )}
        {row.status === "in_progress" && (
          <Button size="sm" variant="outline" onClick={() => onUpdate(row.id, "new")}>
            Back to new
          </Button>
        )}
        {row.status !== "resolved" && (
          <Button size="sm" onClick={() => onUpdate(row.id, "resolved")}>
            Mark resolved
          </Button>
        )}
        {row.status === "resolved" && (
          <Button size="sm" variant="outline" onClick={() => onUpdate(row.id, "new")}>
            Reopen
          </Button>
        )}
      </div>
    </Card>
  );
}

function InfoRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground w-16 shrink-0">{label}</span>
      <span className={`truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
