import { motion } from "framer-motion";
import { ArrowRight, Phone } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function CTA() {
  return (
    <section id="cta" className="px-6 py-24 md:py-32">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-dark p-10 text-center shadow-elegant md:p-20"
      >
        <div className="glow-orb -top-20 left-1/2 h-80 w-80 -translate-x-1/2 bg-primary opacity-50" />
        <div className="glow-orb bottom-0 right-0 h-60 w-60 bg-primary-glow opacity-30" />

        <div className="relative">
          <h2 className="font-display text-4xl font-bold tracking-tight text-surface-foreground md:text-6xl">
            Ready To Run Your Gym Like A Business?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-surface-foreground/70">
            Start your 7-day free trial and see why modern gyms choose Gymphony. No setup fees, no credit card required.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-brand px-8 py-4 text-sm font-semibold text-primary-foreground shadow-glow transition-all hover:-translate-y-0.5"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="tel:7906240659"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 py-4 text-sm font-semibold text-surface-foreground backdrop-blur transition-all hover:bg-white/10"
            >
              <Phone className="h-4 w-4" />
              Book Demo
            </a>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
