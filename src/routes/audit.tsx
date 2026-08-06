import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/audit")({
  beforeLoad: () => { throw redirect({ to: "/reconcile" }); },
});
