import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { AdminRoute } from "@/components/AdminRoute";
import { PlatformAdminDashboard } from "@/components/platform-admin/PlatformAdminDashboard";

export const Route = createFileRoute("/platform-admin")({
  head: () => ({
    meta: [
      { title: "Platform Super Admin — Gymphony" },
      { name: "description", content: "Platform-wide gyms, subscriptions, members and login activity." },
      // Belt-and-suspenders: never let this surface get indexed.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PlatformAdminPage,
});

function PlatformAdminPage() {
  return (
    <AdminRoute>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <Navbar />
        <main className="container mx-auto flex-grow px-4 py-24 sm:px-6">
          <PlatformAdminDashboard />
        </main>
        <Footer />
      </div>
    </AdminRoute>
  );
}
