import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UserMinus, Trash2, QrCode } from "lucide-react";
import { TerminationsPanel } from "@/components/operations/TerminationsPanel";
import { DeletionsPanel } from "@/components/operations/DeletionsPanel";
import { FindLockerPanel } from "@/components/operations/FindLockerPanel";

export const Route = createFileRoute("/operations")({
  head: () => ({
    meta: [
      { title: "Operations — LockerOps" },
      { name: "description", content: "Terminations, deletion audit, and find-my-locker in one place." },
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
          Manage terminations, audit deletions, and look up lockers — all in one place.
        </p>

        <Tabs defaultValue="terminations">
          <TabsList>
            <TabsTrigger value="terminations"><UserMinus className="h-4 w-4 mr-1.5" /> Terminations</TabsTrigger>
            <TabsTrigger value="deletions"><Trash2 className="h-4 w-4 mr-1.5" /> Deletion Audit</TabsTrigger>
            <TabsTrigger value="find-locker"><QrCode className="h-4 w-4 mr-1.5" /> Find-My-Locker</TabsTrigger>
          </TabsList>

          <TabsContent value="terminations" className="mt-6"><TerminationsPanel /></TabsContent>
          <TabsContent value="deletions" className="mt-6"><DeletionsPanel /></TabsContent>
          <TabsContent value="find-locker" className="mt-6"><FindLockerPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
