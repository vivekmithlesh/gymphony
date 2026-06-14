import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CityLeaderboard } from "@/components/CityLeaderboard";
import { FeatureRouteGuard } from "@/components/FeatureRouteGuard";

export const Route = createFileRoute("/city-leaderboard")({
  head: () => ({
    meta: [
      { title: "City Leaderboard — Gymphony" },
      {
        name: "description",
        content: "View the top calorie-burning gyms in your city.",
      },
    ],
  }),
  component: CityLeaderboardPage,
});

function CityLeaderboardPage() {
  return (
    <DashboardLayout activeTab="🏆 Leaderboard">
      <FeatureRouteGuard feature="leaderboard" featureLabel="City Leaderboard">
        <CityLeaderboard />
      </FeatureRouteGuard>
    </DashboardLayout>
  );
}