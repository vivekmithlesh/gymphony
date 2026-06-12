import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
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
  // Identity from the global AuthProvider (single source of truth).
  const { user } = useAuth();

  return <GymDetailView gymId={gymId} memberId={user?.id} />;
}
