import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms & Conditions — Gymphony" }] }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      updated="June 2026"
      intro="By accessing or using Gymphony, you agree to these Terms & Conditions. Please read them carefully."
    >
      <section>
        <h2>1. Use of the Service</h2>
        <p>
          Gymphony provides gym management and member-engagement software to gym owners and their
          members. You agree to use the service only for lawful purposes and in line with these terms.
        </p>
      </section>
      <section>
        <h2>2. Accounts</h2>
        <p>
          You are responsible for keeping your account credentials secure and for all activity that
          occurs under your account.
        </p>
      </section>
      <section>
        <h2>3. Payments &amp; Subscriptions</h2>
        <p>
          Paid plans are billed as described at checkout. Subscription terms, renewals, and
          cancellations are governed by these terms and our Refund Policy.
        </p>
      </section>
      <section>
        <h2>4. Contact</h2>
        <p>
          Questions about these terms? Email <a href="mailto:hello@gymphony.app">hello@gymphony.app</a>.
        </p>
      </section>
    </LegalPage>
  );
}
