import { motion } from "framer-motion";
import { Globe, MapPin, Trophy, ArrowRight } from "lucide-react";

const features = [
  {
    icon: Globe,
    title: "Beautiful Gym Profile",
    desc: "A polished public page with photos, classes, trainers and reviews — works as your mini-website.",
  },
  {
    icon: MapPin,
    title: "City Discovery Map",
    desc: "Show up when nearby fitness seekers search. Get inquiries directly into your dashboard.",
  },
  {
    icon: Trophy,
    title: "Leaderboard Ranking",
    desc: "Climb your city's rankings with reviews, retention and activity. Stand out from the rest.",
  },
];

export function Marketing() {
  return (
    <section id="marketing" className="relative overflow-hidden py-24 md:py-32">
      <div className="absolute inset-0 bg-gradient-brand-soft" />
      <div className="glow-orb top-20 left-10 h-72 w-72 bg-primary-glow opacity-40" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-6 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Get discovered
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Get discovered by new members{" "}
            <span className="text-gradient-brand">in your city.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Gymphony is more than software — it's a marketplace. Every gym on the platform gets a profile, a map pin, and a ranking that brings new members to your door.
          </p>

          <div className="mt-8 space-y-4">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="flex gap-4 rounded-2xl border border-border/60 bg-card/80 p-5 backdrop-blur transition-all hover:border-primary/40 hover:shadow-soft"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-primary-foreground shadow-soft">
                  <f.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          <div className="rounded-3xl border border-border bg-card p-6 shadow-elegant">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Top Gyms in Mumbai</h4>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Live
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {[
                { rank: 1, name: "Iron Republic", score: "98", trend: "+12" },
                { rank: 2, name: "FitForge Andheri", score: "96", trend: "+8" },
                { rank: 3, name: "Pulse Powerhouse", score: "94", trend: "+5" },
                { rank: 4, name: "Your Gym", score: "—", trend: "Join", you: true },
              ].map((g) => (
                <div
                  key={g.rank}
                  className={`flex items-center gap-4 rounded-xl border p-3.5 ${
                    g.you
                      ? "border-primary bg-gradient-brand-soft"
                      : "border-border bg-background"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold ${
                      g.rank <= 3
                        ? "bg-gradient-brand text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {g.rank}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-xs text-muted-foreground">Mumbai • Strength & Cardio</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{g.score}</p>
                    <p className="text-xs text-primary">{g.trend}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand py-3 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">
              Claim your ranking
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
