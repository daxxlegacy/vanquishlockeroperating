import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UserMinus, Zap, History, Trash2, QrCode } from "lucide-react";
import { TerminationsPanel } from "@/components/operations/TerminationsPanel";
import { AutomationPanel } from "@/components/operations/AutomationPanel";
import { RunHistoryPanel } from "@/components/operations/RunHistoryPanel";
import { DeletionsPanel } from "@/components/operations/DeletionsPanel";
import { FindLockerPanel } from "@/components/operations/FindLockerPanel";

export const Route = createFileRoute("/operations")({
  head: () => ({
    meta: [
      { title: "Operations — LockerOps" },
      { name: "description", content: "Terminations, automation, run history, and deletion audit in one place." },
    ],
  }),
  component: () => (<PageGuard permission="page_operations"><OperationsPage /></PageGuard>),
});

function OperationsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="font-display text-3xl font-bold mb-1">Operations</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Manage terminations, run automation, review history, and audit deletions — all in one place.
        </p>

        <Tabs defaultValue="terminations">
          <TabsList>
            <TabsTrigger value="terminations"><UserMinus className="h-4 w-4 mr-1.5" /> Terminations</TabsTrigger>
            <TabsTrigger value="automation"><Zap className="h-4 w-4 mr-1.5" /> Automation</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1.5" /> Run History</TabsTrigger>
            <TabsTrigger value="deletions"><Trash2 className="h-4 w-4 mr-1.5" /> Deletion Audit</TabsTrigger>
            <TabsTrigger value="find-locker"><QrCode className="h-4 w-4 mr-1.5" /> Find-My-Locker</TabsTrigger>
          </TabsList>

          <TabsContent value="terminations" className="mt-6"><TerminationsPanel /></TabsContent>
          <TabsContent value="automation" className="mt-6"><AutomationPanel /></TabsContent>
          <TabsContent value="history" className="mt-6"><RunHistoryPanel /></TabsContent>
          <TabsContent value="deletions" className="mt-6"><DeletionsPanel /></TabsContent>
          <TabsContent value="find-locker" className="mt-6"><FindLockerPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
