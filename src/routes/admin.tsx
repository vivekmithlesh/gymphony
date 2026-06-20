import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { AdminRoute } from "@/components/AdminRoute";
import { AdminUpiConfig } from "@/components/AdminUpiConfig";
import { AdminSubscriptions } from "@/components/AdminSubscriptions";
import { AdminPayoneerConfig } from "@/components/AdminPayoneerConfig";
import { AdminIntlPayments } from "@/components/AdminIntlPayments";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Platform Admin — Gymphony" },
      { name: "description", content: "Verify owner subscription payments and configure platform billing." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <AdminRoute>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <Navbar />
        <main className="container mx-auto flex-grow space-y-8 px-6 py-24">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Platform Admin</h1>
            <p className="text-muted-foreground">Verify owner subscription payments and configure billing.</p>
          </div>
          <AdminUpiConfig />
          <AdminSubscriptions />
          <AdminPayoneerConfig />
          <AdminIntlPayments />
        </main>
        <Footer />
      </div>
    </AdminRoute>
  );
}
