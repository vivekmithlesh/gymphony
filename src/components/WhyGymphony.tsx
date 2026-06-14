import { motion } from "framer-motion";
import { CalendarClock, QrCode, LineChart, LayoutGrid } from "lucide-react";

const cards = [
  {
    icon: CalendarClock,
    title: "Never Miss A Renewal",
    desc: "Track pending dues and membership expiries before revenue slips away.",
  },
  {
    icon: QrCode,
    title: "Replace Registers Forever",
    desc: "QR attendance and kiosk mode eliminate manual tracking.",
  },
  {
    icon: LineChart,
    title: "Know Your Business Daily",
    desc: "Revenue dashboards give instant visibility into gym performance.",
  },
  {
    icon: LayoutGrid,
    title: "Manage Everything From One Place",
    desc: "Members, attendance, plans, inventory, and activity logs.",
  },
];

export function WhyGymphony() {
  return (
    <section id="why" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Why Gymphony
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Stop running your gym{" "}
            <span className="text-gradient-brand">on guesswork.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Four reasons owners switch — and never go back to registers and spreadsheets.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c, i) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-elegant"
            >
              <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-brand opacity-0 blur-3xl transition-opacity group-hover:opacity-20" />
              <div className="relative">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-brand text-primary-foreground shadow-soft">
                  <c.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-lg font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{c.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
