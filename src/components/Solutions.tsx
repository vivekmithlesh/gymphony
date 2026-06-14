import { motion } from "framer-motion";
import {
  CreditCard,
  BrainCircuit,
  QrCode,
  MessageCircle,
  LineChart,
  MapPin,
  Check,
} from "lucide-react";

const features = [
  {
    icon: CreditCard,
    title: "Get paid on time, automatically",
    desc: "Gymphony chases dues and renewals over WhatsApp so you don't have to. Members pay by UPI or card in seconds — and you keep 100% of it.",
    bullets: ["Auto dues & renewal reminders", "UPI + card collection", "0% platform fee on payments"],
  },
  {
    icon: BrainCircuit,
    title: "Catch members before they quit",
    desc: "The AI Retention Engine flags any active member who's stopped showing up — then lets you win them back with one tap before they cancel.",
    bullets: ["At-risk member alerts", "Live retention rate", "One-tap WhatsApp win-back"],
  },
  {
    icon: QrCode,
    title: "A front desk that runs itself",
    desc: "Members check in by scanning one QR — no app, no register, no staff. Geo-fenced wall check-in confirms they're actually in the building.",
    bullets: ["Scan-to-enter, any phone", "Live 'who's in now' count", "Geo-verified attendance"],
  },
  {
    icon: MessageCircle,
    title: "Answer every lead in seconds — 24/7",
    desc: "Your AI WhatsApp receptionist replies to plan, price and timing questions instantly using your gym's real details. Step in any time to take over.",
    bullets: ["Instant after-hours replies", "Trained on your plans & hours", "Human takeover on demand"],
  },
  {
    icon: LineChart,
    title: "Know your numbers cold",
    desc: "Revenue, churn, peak hours and plan mix — live, on every device. Export a clean financial report for your accountant in one click.",
    bullets: ["Revenue & churn analytics", "Peak-hours insights", "One-click Excel reports"],
  },
  {
    icon: MapPin,
    title: "New members find you first",
    desc: "Every gym gets a public profile, a city map pin and a leaderboard rank — so nearby members searching for a gym land on you, not a competitor.",
    bullets: ["Public gym profile page", "City discovery map", "Leaderboard ranking & leads"],
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
            One platform. Every revenue leak closed.
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Everything it takes to run a profitable gym.{" "}
            <span className="text-gradient-brand">In one place.</span>
          </h2>
          <p className="mt-4 text-lg text-surface-foreground/70">
            Replace 5 tools, 3 spreadsheets and a notebook with a single platform built to protect — and grow — your revenue.
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
