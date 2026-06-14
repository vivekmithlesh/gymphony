import { motion } from "framer-motion";
import { NotebookPen, Sheet, ClipboardList, Wallet, ArrowRight } from "lucide-react";

const replacing = [
  { icon: NotebookPen, label: "Paper registers" },
  { icon: Sheet, label: "Excel sheets" },
  { icon: ClipboardList, label: "Manual attendance" },
  { icon: Wallet, label: "Manual payment tracking" },
];

export function Objections() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Still doing it the hard way?
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            If you're still using these,{" "}
            <span className="text-gradient-brand">you're working for your gym.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Gymphony replaces all of it with one dashboard — so your gym works for you.
          </p>
        </div>

        <div className="mt-14 flex flex-col items-center gap-8 md:flex-row md:justify-center">
          <div className="grid w-full max-w-md grid-cols-2 gap-4">
            {replacing.map((r, i) => (
              <motion.div
                key={r.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <r.icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-muted-foreground line-through decoration-destructive/40">
                  {r.label}
                </span>
              </motion.div>
            ))}
          </div>

          <ArrowRight className="hidden h-8 w-8 shrink-0 text-primary md:block" />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5 }}
            className="flex w-full max-w-xs flex-col items-center justify-center rounded-3xl bg-gradient-dark p-10 text-center text-surface-foreground shadow-elegant"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
              <span className="font-display text-2xl font-bold text-white">G</span>
            </div>
            <p className="mt-4 font-display text-2xl font-bold">One Gymphony login</p>
            <p className="mt-2 text-sm text-surface-foreground/70">
              Members, attendance, payments, dues and revenue — all in one place.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
