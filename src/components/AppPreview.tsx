import { motion } from "framer-motion";
import screens from "@/assets/app-screens.png";

const labels = ["Dashboard", "Members", "Payments", "Attendance"];

export function AppPreview() {
  return (
    <section id="preview" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Built for every screen
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            A pocket-sized control room
            <br />
            for your entire gym.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Designed mobile-first so you can run operations from anywhere — the floor, the café, or the beach.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
          className="relative mt-16"
        >
          <div className="absolute -inset-x-10 -inset-y-6 rounded-[3rem] bg-gradient-brand opacity-10 blur-3xl" />
          <div className="relative overflow-hidden rounded-3xl bg-gradient-brand-soft p-6 shadow-elegant md:p-12">
            <img
              src={screens}
              alt="Gymphony mobile app screens"
              loading="lazy"
              width={1600}
              height={1100}
              className="w-full"
            />
          </div>
        </motion.div>

        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          {labels.map((l) => (
            <div
              key={l}
              className="rounded-xl border border-border bg-card px-4 py-3 text-center text-sm font-semibold text-foreground"
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
