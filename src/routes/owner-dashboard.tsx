import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/owner-dashboard")({
  component: OwnerDashboardAlias,
});

function OwnerDashboardAlias() {
  if (typeof window !== "undefined") {
    window.location.replace("/dashboard");
  }

  return null;
}
