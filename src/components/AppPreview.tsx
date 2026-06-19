import { motion } from "framer-motion";
import screens from "@/assets/app-screens-v2.png";

const labels = ["Live revenue", "At-risk members", "Payments & dues", "QR attendance"];

export function AppPreview() {
  return (
    <section id="preview" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Run the whole business from your phone
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Every number that decides
            <br />
            your profit — in your pocket.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            See today's revenue, who's at risk of quitting, and who still owes you — from the floor, the café, or wherever you are. Decisions in seconds, not spreadsheets.
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
              width={740}
              height={357}
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
