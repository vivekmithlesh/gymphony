import { createFileRoute } from "@tanstack/react-router";

import MemberDashboard from "@/member-dashboard";

export const Route = createFileRoute("/member-dashboard")({
  head: () => ({
    meta: [
      { title: "Member Dashboard — Gymphony" },
      {
        name: "description",
        content: "Track today's calories, goals, and workouts in the member dashboard.",
      },
    ],
  }),
  component: MemberDashboard,
});
