import { createFileRoute } from "@tanstack/react-router";
import { JoinGymFlow } from "@/components/JoinGymFlow";

export const Route = createFileRoute("/join/$gymId")({
  head: () => ({
    meta: [
      { title: "Join the gym — Gymphony" },
      {
        name: "description",
        content: "Scan, pick a plan, and activate your gym membership in seconds.",
      },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { gymId } = Route.useParams();
  return <JoinGymFlow gymId={gymId} />;
}
