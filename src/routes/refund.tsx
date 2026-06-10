import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/refund")({
  head: () => ({ meta: [{ title: "Cancellation & Refund Policy — Gymphony" }] }),
  component: RefundPage,
});

function RefundPage() {
  return (
    <LegalPage
      title="Cancellation & Refund Policy"
      updated="June 2026"
      intro="This policy describes how cancellations and refunds are handled for Gymphony subscriptions."
    >
      <section>
        <h2>1. Cancellations</h2>
        <p>
          You may cancel your subscription at any time from your account settings. Access continues
          until the end of the current billing period.
        </p>
      </section>
      <section>
        <h2>2. Refunds</h2>
        <p>
          Subscription fees are generally non-refundable except where required by law. If you believe
          you were charged in error, contact us and we will review your request.
        </p>
      </section>
      <section>
        <h2>3. Requesting a Refund</h2>
        <p>
          To request a refund or report a billing issue, email{" "}
          <a href="mailto:hello@gymphony.app">hello@gymphony.app</a> with your account details.
        </p>
      </section>
    </LegalPage>
  );
}
