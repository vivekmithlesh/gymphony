import { motion } from "framer-motion";
import { TrendingDown, UserMinus, EyeOff } from "lucide-react";

const items = [
  {
    icon: TrendingDown,
    title: "Fees slip through the cracks",
    desc: "Members forget, dues pile up, and you spend your evenings sending awkward WhatsApp reminders. Every uncollected month is pure profit walking out the door.",
    loss: "₹15,000–40,000 in unpaid dues every month",
  },
  {
    icon: UserMinus,
    title: "Members quit — and you find out too late",
    desc: "A member stops showing up for three weeks, then cancels. By the time you notice, they're gone. Replacing them costs 5× more than keeping them.",
    loss: "20–30% of members churn out every year",
  },
  {
    icon: EyeOff,
    title: "New members can't find you",
    desc: "People searching for a gym in your city land on competitors with louder marketing — not because they're better, but because you're invisible online.",
    loss: "Dozens of ready-to-join leads lost monthly",
  },
];

export function Problems() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            The hidden cost of running on memory & notebooks
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Your gym is leaking money in three places right now.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Most owners don't lose money on big mistakes — they lose it on small leaks that run all year.
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
                <p className="mt-5 inline-flex rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
                  {item.loss}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
