import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/automation-history")({
  beforeLoad: () => { throw redirect({ to: "/operations" }); },
});
