import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PLAN_LIST, formatINR, TRIAL_DAYS, isComingSoonHighlight, type BillingCycle } from "@/lib/plans";

export function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  return (
    <section id="pricing" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Pricing
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            One plan less than{" "}
            <span className="text-gradient-brand">a single membership.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Every plan starts with a {TRIAL_DAYS}-day free trial. No setup fees, 0% fee on member
            payments, cancel anytime.
          </p>

          {/* Billing cycle toggle */}
          <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-card p-1.5">
            <button
              onClick={() => setCycle("monthly")}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-all ${
                cycle === "monthly" ? "bg-gradient-brand text-primary-foreground shadow-soft" : "text-muted-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setCycle("yearly")}
              className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all ${
                cycle === "yearly" ? "bg-gradient-brand text-primary-foreground shadow-soft" : "text-muted-foreground"
              }`}
            >
              Yearly
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                2 months free
              </span>
            </button>
          </div>
        </div>

        <div className="mx-auto mt-16 grid max-w-6xl items-start gap-6 lg:grid-cols-3">
          {PLAN_LIST.map((p, i) => {
            const perMonth = cycle === "yearly" ? p.priceYearlyPerMonth : p.priceMonthly;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={`relative overflow-hidden rounded-3xl p-8 ${
                  p.popular
                    ? "bg-gradient-dark text-surface-foreground shadow-elegant lg:-mt-4 lg:mb-0"
                    : "border border-border bg-card"
                }`}
              >
                {p.popular && (
                  <>
                    <div className="glow-orb -top-20 -right-20 h-60 w-60 bg-primary-glow opacity-40" />
                    <div className="absolute right-6 top-6 inline-flex items-center gap-1 rounded-full bg-gradient-brand px-3 py-1 text-xs font-semibold text-primary-foreground">
                      <Sparkles className="h-3 w-3" />
                      Most Popular
                    </div>
                  </>
                )}

                <div className="relative">
                  <h3 className="text-xl font-semibold">{p.name}</h3>
                  <p className={`mt-1 text-sm ${p.popular ? "text-surface-foreground/70" : "text-muted-foreground"}`}>
                    {p.tagline}
                  </p>

                  <div className="mt-5 flex items-baseline gap-2">
                    <span className="font-display text-5xl font-bold tracking-tight">
                      {formatINR(perMonth)}
                    </span>
                    <span className={p.popular ? "text-surface-foreground/70" : "text-muted-foreground"}>
                      / month
                    </span>
                  </div>
                  <p className={`mt-1 text-xs font-medium ${p.popular ? "text-surface-foreground/60" : "text-muted-foreground"}`}>
                    {cycle === "yearly"
                      ? `${formatINR(p.priceYearlyTotal)} billed yearly`
                      : `${TRIAL_DAYS}-day free trial included`}
                  </p>

                  <Link
                    to="/signup"
                    className={`mt-6 inline-flex w-full items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-all hover:-translate-y-0.5 ${
                      p.popular
                        ? "bg-gradient-brand text-primary-foreground shadow-glow"
                        : "border border-border bg-background text-foreground hover:border-primary"
                    }`}
                  >
                    Start Free Trial
                  </Link>

                  <ul className="mt-8 space-y-3">
                    {p.highlights.map((f) => {
                      const comingSoon = isComingSoonHighlight(f);
                      return (
                        <li key={f} className={`flex items-start gap-3 text-sm ${comingSoon ? "opacity-60" : ""}`}>
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                              p.popular ? "bg-primary-glow/20 text-primary-glow" : "bg-primary/10 text-primary"
                            }`}
                          >
                            <Check className="h-3 w-3" />
                          </span>
                          <span>{f}</span>
                          {comingSoon && (
                            <span className="ml-auto shrink-0 rounded-full border border-amber-300/60 bg-amber-100/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-500">
                              Coming soon
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </motion.div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm font-medium text-muted-foreground">
          💡 Pay yearly and get <span className="font-bold text-foreground">2 months free</span> on every plan.
        </p>
      </div>
    </section>
  );
}
