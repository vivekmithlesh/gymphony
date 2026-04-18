import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";

const plans = [
  {
    name: "Free Trial",
    price: "₹0",
    period: "for 1 month",
    desc: "Everything in Pro. No card required. Cancel anytime.",
    features: [
      "Up to 100 members",
      "Smart payments + UPI",
      "QR attendance",
      "Live dashboard",
      "Email support",
    ],
    cta: "Start Free Trial",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "₹1,999",
    period: "/ month",
    desc: "For serious gym owners ready to automate and grow.",
    features: [
      "Unlimited members",
      "Smart payments + auto reminders",
      "QR attendance + alerts",
      "Live dashboard & analytics",
      "City discovery + leaderboard",
      "Public gym profile page",
      "Priority WhatsApp support",
    ],
    cta: "Get Pro",
    highlighted: true,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Pricing
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Simple pricing.{" "}
            <span className="text-gradient-brand">Serious results.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            One flat plan. Everything included. Cancel anytime.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl gap-6 md:grid-cols-2">
          {plans.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={`relative overflow-hidden rounded-3xl p-8 ${
                p.highlighted
                  ? "bg-gradient-dark text-surface-foreground shadow-elegant"
                  : "border border-border bg-card"
              }`}
            >
              {p.highlighted && (
                <>
                  <div className="glow-orb -top-20 -right-20 h-60 w-60 bg-primary-glow opacity-40" />
                  <div className="absolute right-6 top-6 inline-flex items-center gap-1 rounded-full bg-gradient-brand px-3 py-1 text-xs font-semibold text-primary-foreground">
                    <Sparkles className="h-3 w-3" />
                    Most popular
                  </div>
                </>
              )}

              <div className="relative">
                <h3 className="text-xl font-semibold">{p.name}</h3>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="font-display text-5xl font-bold tracking-tight">
                    {p.price}
                  </span>
                  <span className={p.highlighted ? "text-surface-foreground/70" : "text-muted-foreground"}>
                    {p.period}
                  </span>
                </div>
                <p className={`mt-3 ${p.highlighted ? "text-surface-foreground/80" : "text-muted-foreground"}`}>
                  {p.desc}
                </p>

                <a
                  href="#cta"
                  className={`mt-6 inline-flex w-full items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-all hover:-translate-y-0.5 ${
                    p.highlighted
                      ? "bg-gradient-brand text-primary-foreground shadow-glow"
                      : "border border-border bg-background text-foreground hover:border-primary"
                  }`}
                >
                  {p.cta}
                </a>

                <ul className="mt-8 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          p.highlighted ? "bg-primary-glow/20 text-primary-glow" : "bg-primary/10 text-primary"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
