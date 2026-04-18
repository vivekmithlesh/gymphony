import { motion } from "framer-motion";
import { PhoneOff, FileX, EyeOff } from "lucide-react";

const items = [
  {
    icon: PhoneOff,
    title: "Manual payment follow-ups",
    desc: "Endless WhatsApp reminders and awkward fee collection calls draining your time and energy every single week.",
  },
  {
    icon: FileX,
    title: "Lost attendance records",
    desc: "Paper registers and notebook tracking — no clean data on who's active, who's slipping, who's about to leave.",
  },
  {
    icon: EyeOff,
    title: "No online visibility",
    desc: "New members can't find your gym. Competitors with weaker offerings are showing up first on every search.",
  },
];

export function Problems() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            The Problem
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Running a gym shouldn't feel like running in place.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Owners burn 10+ hours a week on tasks that should be automatic.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {items.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-elegant"
            >
              <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-brand opacity-0 blur-3xl transition-opacity group-hover:opacity-20" />
              <div className="relative">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <item.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold">{item.title}</h3>
                <p className="mt-3 text-muted-foreground">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
