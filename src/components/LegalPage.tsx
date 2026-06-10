import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Logo } from "./Logo";
import { Footer } from "./Footer";

interface LegalPageProps {
  title: string;
  updated: string;
  intro?: string;
  children: ReactNode;
}

/**
 * Shared chrome for Gymphony's public legal pages (Terms, Privacy, Refund).
 * Required for payment-gateway (Razorpay/Stripe) SaaS approval, which verifies
 * these policies exist on public, linkable URLs.
 */
export function LegalPage({ title, updated, intro, children }: LegalPageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/">
            <Logo />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-slate-900 md:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        {intro && <p className="mt-6 leading-relaxed text-slate-600">{intro}</p>}

        <div className="mt-8 space-y-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-900 [&_p]:mt-2 [&_p]:leading-relaxed [&_p]:text-slate-600 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_li]:text-slate-600 [&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline">
          {children}
        </div>

        <p className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          This is a general policy template provided for platform completeness and is not legal
          advice. Replace with policies reviewed by your legal counsel before going to production.
        </p>
      </main>

      <Footer />
    </div>
  );
}

export default LegalPage;
