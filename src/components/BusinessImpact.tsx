import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  ShieldCheck,
  Clock,
  TrendingUp,
  ScanLine,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

const benefits = [
  {
    icon: CalendarCheck,
    title: "Reduce missed renewals",
    desc: "Dues and expiries surface automatically, so revenue never slips through unnoticed.",
  },
  {
    icon: ShieldCheck,
    title: "Increase member accountability",
    desc: "Attendance is tracked the moment members walk in — no more guessing who's active.",
  },
  {
    icon: Clock,
    title: "Save hours every week",
    desc: "Automation replaces the follow-ups, registers and spreadsheets that eat your evenings.",
  },
  {
    icon: TrendingUp,
    title: "Track revenue in real time",
    desc: "See today's numbers the moment they happen — decisions in seconds, not month-end.",
  },
  {
    icon: ScanLine,
    title: "Eliminate manual attendance",
    desc: "QR and kiosk check-ins remove the front-desk bottleneck entirely.",
  },
];

export function BusinessImpact() {
  return (
    <section id="results" className="relative overflow-hidden py-24 md:py-32">
      <div className="absolute inset-0 bg-gradient-brand-soft" />
      <div className="glow-orb top-20 right-10 h-72 w-72 bg-primary-glow opacity-40" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Real business impact
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Built For Gym Owners Who{" "}
            <span className="text-gradient-brand">Want Growth</span>
          </h2>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((b, i) => (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="group flex items-start gap-5 rounded-2xl border border-border/60 bg-card/80 p-7 backdrop-blur transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-elegant"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-primary-foreground shadow-soft">
                <b.icon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{b.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{b.desc}</p>
              </div>
            </motion.div>
          ))}

          {/* CTA tile to balance the 6th grid cell */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-col items-start justify-center gap-4 rounded-2xl bg-gradient-dark p-7 text-surface-foreground shadow-elegant"
          >
            <p className="font-display text-xl font-bold leading-snug">
              See it work on your own gym.
            </p>
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-all hover:-translate-y-0.5"
            >
              Start 7-Day Free Trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
