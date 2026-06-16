import { createFileRoute } from "@tanstack/react-router";
import { SelfCheckIn } from "@/components/SelfCheckIn";

export const Route = createFileRoute("/checkin/$gymId")({
  head: () => ({
    meta: [
      { title: "Check in — Gymphony" },
      {
        name: "description",
        content: "Scan the gym's QR to mark today's attendance.",
      },
    ],
  }),
  component: CheckinPage,
});

function CheckinPage() {
  const { gymId } = Route.useParams();
  return <SelfCheckIn gymId={gymId} />;
}
