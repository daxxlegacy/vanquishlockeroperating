import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/automation")({
  beforeLoad: () => { throw redirect({ to: "/operations" }); },
});
