import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/supabase";
import { GymDetailView } from "@/components/GymDetailView";

export const Route = createFileRoute("/gym-detail/$gymId")({
  head: ({ params }) => ({
    meta: [
      { title: `Gym Details — Gymphony` },
      {
        name: "description",
        content: "View gym details, photos, reviews, and community stats on Gymphony.",
      },
    ],
  }),
  component: GymDetailPage,
});

function GymDetailPage() {
  const { gymId } = Route.useParams();
  const navigate = useNavigate();
  const [memberId, setMemberId] = useState<string | undefined>();

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user?.id) {
        setMemberId(session.user.id);
      }
    };

    void getUser();
  }, []);

  return <GymDetailView gymId={gymId} memberId={memberId} />;
}
