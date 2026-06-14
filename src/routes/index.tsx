import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { WhyGymphony } from "@/components/WhyGymphony";
import { Solutions } from "@/components/Solutions";
import { KioskHero } from "@/components/KioskHero";
import { BusinessImpact } from "@/components/BusinessImpact";
import { AppPreview } from "@/components/AppPreview";
import { DiscoverySection } from "@/components/DiscoverySection";
import { Objections } from "@/components/Objections";
import { Trust } from "@/components/Trust";
import { Pricing } from "@/components/Pricing";
import { CTA } from "@/components/CTA";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gymphony — Collect Every Fee. Keep Every Member. Run Your Gym Smarter." },
      {
        name: "description",
        content:
          "Gymphony helps gym owners automate attendance, track revenue, manage memberships, monitor dues, and run their entire fitness business from one powerful dashboard. 7-day free trial. No setup fees.",
      },
      { property: "og:title", content: "Gymphony — The complete gym management platform" },
      {
        property: "og:description",
        content:
          "Automate attendance, track revenue, manage memberships and dues from one dashboard. QR check-in, kiosk mode, revenue analytics. Start your 7-day free trial.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Hero />
        <WhyGymphony />
        <Solutions />
        <KioskHero />
        <BusinessImpact />
        <AppPreview />
        <DiscoverySection />
        <Objections />
        <Trust />
        <Pricing />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
