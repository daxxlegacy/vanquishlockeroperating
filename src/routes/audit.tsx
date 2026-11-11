// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/audit")({
  beforeLoad: () => { throw redirect({ to: "/reconcile" }); },
});
