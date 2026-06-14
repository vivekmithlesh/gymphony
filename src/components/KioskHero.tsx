import { motion } from "framer-motion";
import { QrCode, ScanLine, Clock, Users, CheckCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

const points = [
  { icon: ScanLine, text: "Members scan and check in instantly" },
  { icon: Users, text: "No registers" },
  { icon: Clock, text: "No queues" },
  { icon: CheckCircle2, text: "No staff dependency" },
];

export function KioskHero() {
  return (
    <section id="kiosk" className="relative overflow-hidden bg-gradient-dark py-24 text-surface-foreground md:py-32">
      <div className="glow-orb top-0 right-1/4 h-96 w-96 bg-primary opacity-30" />
      <div className="glow-orb bottom-0 left-0 h-80 w-80 bg-primary-glow opacity-20" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-6 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider text-primary-glow">
            Kiosk Mode
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Turn Any Tablet Into A{" "}
            <span className="text-gradient-brand">Self-Service Check-In Station</span>
          </h2>
          <p className="mt-5 text-lg text-surface-foreground/70">
            Members scan and check in instantly. No registers. No queues. No staff dependency.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {points.map((p) => (
              <div
                key={p.text}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-primary-foreground">
                  <p.icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-surface-foreground/90">{p.text}</span>
              </div>
            ))}
          </div>

          <Link
            to="/signup"
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-gradient-brand px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-glow transition-all hover:-translate-y-0.5"
          >
            Set up your kiosk free
          </Link>
        </motion.div>

        {/* Kiosk mock — built from the design system (no external screenshot needed). */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="relative"
        >
          <div className="absolute -inset-8 rounded-[3rem] bg-gradient-brand opacity-20 blur-3xl" />
          <div className="relative mx-auto w-full max-w-sm rounded-[2.5rem] border border-white/15 bg-white/5 p-6 shadow-elegant backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-surface-foreground/60">
                Check-in
              </span>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                </span>
                Live
              </span>
            </div>

            <div className="mt-6 flex flex-col items-center">
              <div className="flex h-44 w-44 items-center justify-center rounded-3xl bg-white p-4 shadow-glow">
                <QrCode className="h-full w-full text-[#1e1b34]" />
              </div>
              <p className="mt-5 text-center font-display text-xl font-bold">Scan to check in</p>
              <p className="mt-1 text-center text-sm text-surface-foreground/60">
                Point your phone at the code
              </p>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-brand font-bold text-white">
                  R
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Welcome back, Rahul!</p>
                  <p className="text-xs text-surface-foreground/60">Checked in · 6:42 PM</p>
                </div>
                <CheckCircle2 className="h-6 w-6 text-green-400" />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
