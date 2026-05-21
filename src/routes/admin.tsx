import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  component: AdminAlias,
});

function AdminAlias() {
  if (typeof window !== "undefined") {
    window.location.replace("/dashboard");
  }

  return null;
}
