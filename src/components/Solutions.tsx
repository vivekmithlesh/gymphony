import { motion } from "framer-motion";
import { CreditCard, QrCode, LineChart, Check } from "lucide-react";

const features = [
  {
    icon: CreditCard,
    title: "Smart Payments",
    desc: "Auto-reminders via WhatsApp & SMS, instant UPI and card collection, with full reconciliation.",
    bullets: ["Auto fee reminders", "UPI, card, net banking", "Zero manual follow-ups"],
  },
  {
    icon: QrCode,
    title: "QR Attendance",
    desc: "Members scan a single QR at the door. No app downloads, no biometric hassles, no friction.",
    bullets: ["Works on any phone", "Live check-in feed", "Inactive member alerts"],
  },
  {
    icon: LineChart,
    title: "Live Dashboard",
    desc: "Track every member, every payment, every visit — in real time, on every device.",
    bullets: ["Revenue analytics", "Member retention", "Class & trainer insights"],
  },
];

export function Solutions() {
  return (
    <section id="features" className="relative overflow-hidden bg-gradient-dark py-24 text-surface-foreground md:py-32">
      <div className="glow-orb top-0 left-1/3 h-96 w-96 bg-primary opacity-30" />
      <div className="glow-orb bottom-0 right-0 h-80 w-80 bg-primary-glow opacity-20" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary-glow">
            The Solution
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Everything your gym needs.{" "}
            <span className="text-gradient-brand">In one place.</span>
          </h2>
          <p className="mt-4 text-lg text-surface-foreground/70">
            Replace 5 tools, 3 spreadsheets, and a notebook with a single beautiful platform.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-primary-glow/40 hover:bg-white/10"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-glow to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
                <f.icon className="h-7 w-7 text-primary-foreground" />
              </div>
              <h3 className="mt-6 text-2xl font-semibold">{f.title}</h3>
              <p className="mt-3 text-surface-foreground/70">{f.desc}</p>
              <ul className="mt-6 space-y-2">
                {f.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-sm text-surface-foreground/85">
                    <Check className="h-4 w-4 text-primary-glow" />
                    {b}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
