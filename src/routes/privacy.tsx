import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — Gymphony" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="June 2026"
      intro="This Privacy Policy explains what information Gymphony collects, how we use it, and the choices you have."
    >
      <section>
        <h2>1. Information We Collect</h2>
        <p>
          We collect account details (such as name, email, and phone), gym and member data you add,
          and usage information needed to operate the service.
        </p>
      </section>
      <section>
        <h2>2. How We Use Information</h2>
        <p>
          Information is used to provide and improve the service, process payments, send
          notifications, and keep your account secure.
        </p>
      </section>
      <section>
        <h2>3. Data Sharing</h2>
        <p>
          We do not sell your data. We share information only with service providers required to run
          Gymphony (such as payment and messaging providers) or where required by law.
        </p>
      </section>
      <section>
        <h2>4. Contact</h2>
        <p>
          For privacy requests, email <a href="mailto:hello@gymphony.app">hello@gymphony.app</a>.
        </p>
      </section>
    </LegalPage>
  );
}
