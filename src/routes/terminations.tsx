import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/terminations")({
  beforeLoad: () => { throw redirect({ to: "/reconcile" }); },
});
