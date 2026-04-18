import { motion } from "framer-motion";
import { ArrowRight, PlayCircle, Sparkles } from "lucide-react";
import dashboard from "@/assets/dashboard-hero.png";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
      {/* Background orbs */}
      <div className="glow-orb -top-20 left-1/4 h-72 w-72 bg-primary-glow" />
      <div className="glow-orb top-40 right-10 h-96 w-96 bg-primary" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,_var(--color-primary-glow)_15%,_transparent),_transparent_60%)]" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-1.5 text-xs font-medium backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>The all-in-one OS for modern gyms</span>
          </div>

          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
            Stop chasing fees.{" "}
            <span className="text-gradient-brand animate-gradient bg-gradient-brand">
              Start growing
            </span>{" "}
            your gym.
          </h1>

          <p className="mt-6 max-w-xl text-lg text-muted-foreground md:text-xl">
            Automate payments, track attendance, and get discovered by new members—all in one premium platform built for ambitious gym owners.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="#cta"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-brand px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-elegant transition-all hover:-translate-y-0.5 hover:shadow-glow"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#cta"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-7 py-3.5 text-sm font-semibold text-foreground transition-all hover:border-primary hover:bg-accent"
            >
              <PlayCircle className="h-4 w-4 text-primary" />
              Book a Demo
            </a>
          </div>

          <div className="mt-10 flex items-center gap-6 text-sm text-muted-foreground">
            <div className="flex -space-x-2">
              {["#7B2CFF", "#C084FC", "#5A0EFF", "#9333EA"].map((c, i) => (
                <div
                  key={i}
                  className="h-8 w-8 rounded-full border-2 border-background"
                  style={{ background: `linear-gradient(135deg, ${c}, #C084FC)` }}
                />
              ))}
            </div>
            <p>
              <span className="font-semibold text-foreground">500+</span> gyms automating with Gymphony
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="relative"
        >
          <div className="absolute -inset-8 rounded-3xl bg-gradient-brand opacity-20 blur-3xl" />
          <div className="relative animate-float rounded-3xl">
            <img
              src={dashboard}
              alt="Gymphony dashboard preview"
              width={1280}
              height={960}
              className="w-full drop-shadow-2xl"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
