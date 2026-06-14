import { motion } from "framer-motion";
import { ShieldCheck, Lock, Percent, Zap, Quote } from "lucide-react";

const pillars = [
  {
    icon: Percent,
    title: "0% payment fees",
    desc: "Members pay you directly. Gymphony never takes a cut of your membership or store revenue.",
  },
  {
    icon: Lock,
    title: "Bank-grade security",
    desc: "Every gym's data is isolated with row-level security. Your members' info is never shared or sold.",
  },
  {
    icon: Zap,
    title: "Live in 10 minutes",
    desc: "Import members, print your QR poster and start collecting fees today — no installer, no hardware.",
  },
  {
    icon: ShieldCheck,
    title: "Cancel anytime",
    desc: "Month-to-month. No lock-in, no setup fees. Stay because it works, not because you're trapped.",
  },
];

export function Trust() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Built to be trusted with your business
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Your money. Your members.{" "}
            <span className="text-gradient-brand">Your data.</span>
          </h2>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-soft"
            >
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
          className="relative mx-auto mt-12 max-w-3xl overflow-hidden rounded-3xl border border-border bg-card p-10 text-center shadow-elegant"
        >
          <div className="glow-orb -top-16 left-1/2 h-48 w-48 -translate-x-1/2 bg-primary-glow opacity-30" />
          <Quote className="relative mx-auto h-8 w-8 text-primary" />
          <p className="relative mt-4 font-display text-xl font-medium leading-relaxed text-foreground md:text-2xl">
            “I used to spend my Sundays calling members about pending fees. Now Gymphony does it for me — and I caught 14 members who'd stopped coming before they cancelled. It paid for itself in the first month.”
          </p>
          <div className="relative mt-6 flex items-center justify-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-brand" />
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">Rohit Sharma</p>
              <p className="text-xs text-muted-foreground">Owner, PowerHouse Gym</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
