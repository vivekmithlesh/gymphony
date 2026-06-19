import { motion } from "framer-motion";
import { ArrowRight, PlayCircle, Sparkles, ShieldCheck } from "lucide-react";
import dashboard from "@/assets/revenue-hero.png";
import { Link } from "@tanstack/react-router";

const proofStats = [
  { value: "7 days", label: "free — full access" },
  { value: "0%", label: "fee on member payments" },
  { value: "10 min", label: "to set up" },
];

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
            <span>The all-in-one growth platform for gyms</span>
          </div>

          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
            Collect Every Fee.{" "}
            <span className="text-gradient-brand animate-gradient bg-gradient-brand">
              Keep Every Member.
            </span>{" "}
            Run Your Gym Smarter.
          </h1>

          <p className="mt-6 max-w-xl text-lg text-muted-foreground md:text-xl">
            Gymphony helps gym owners automate attendance, track revenue, manage memberships, monitor dues, and run their entire fitness business from one powerful dashboard.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-brand px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-elegant transition-all hover:-translate-y-0.5 hover:shadow-glow"
            >
              Start 7-Day Free Trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="#cta"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-7 py-3.5 text-sm font-semibold text-foreground transition-all hover:border-primary hover:bg-accent"
            >
              <PlayCircle className="h-4 w-4 text-primary" />
              Book Demo
            </a>
          </div>

          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            No setup fees • No credit card required • Cancel anytime
          </p>

          {/* Quantified proof band */}
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-border pt-6">
            {proofStats.map((s) => (
              <div key={s.label}>
                <p className="font-display text-2xl font-bold tracking-tight text-foreground">
                  {s.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-6 text-sm text-muted-foreground">
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
              <span className="font-semibold text-foreground">500+</span> gyms run on Gymphony
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
              alt="Gymphony revenue analytics dashboard shown on a laptop"
              width={1264}
              height={842}
              className="w-full drop-shadow-2xl"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
