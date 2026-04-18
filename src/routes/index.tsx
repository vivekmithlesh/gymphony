import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Problems } from "@/components/Problems";
import { Solutions } from "@/components/Solutions";
import { AppPreview } from "@/components/AppPreview";
import { Marketing } from "@/components/Marketing";
import { Pricing } from "@/components/Pricing";
import { CTA } from "@/components/CTA";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gymphony — Stop chasing fees. Start growing your gym." },
      {
        name: "description",
        content:
          "Gymphony is the all-in-one gym management platform. Automate payments, track attendance with QR, and get discovered by new members in your city.",
      },
      { property: "og:title", content: "Gymphony — Modern Gym Management Platform" },
      {
        property: "og:description",
        content:
          "Automate payments, track attendance, and get discovered by new members—all in one premium platform.",
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
        <Problems />
        <Solutions />
        <AppPreview />
        <Marketing />
        <Pricing />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
