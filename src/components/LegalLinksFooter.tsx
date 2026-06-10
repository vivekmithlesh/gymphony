import { Fragment } from "react";

interface LegalLinksFooterProps {
  termsUrl?: string | null;
  privacyUrl?: string | null;
  refundUrl?: string | null;
  className?: string;
}

// Ensure every link has a scheme so it opens as an absolute URL.
const normalize = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

// Renders the owner's legal/compliance links (Terms · Privacy · Refund) for the
// member app + checkout footer — what payment gateways require to be visible.
// Self-hides when no links are set.
export function LegalLinksFooter({ termsUrl, privacyUrl, refundUrl, className }: LegalLinksFooterProps) {
  const links = [
    { label: "Terms & Conditions", url: termsUrl },
    { label: "Privacy Policy", url: privacyUrl },
    { label: "Refund Policy", url: refundUrl },
  ].filter((l) => l.url && l.url.trim());

  if (links.length === 0) return null;

  return (
    <footer
      className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-400 ${className ?? ""}`}
    >
      {links.map((l, i) => (
        <Fragment key={l.label}>
          {i > 0 && <span aria-hidden className="text-slate-300">·</span>}
          <a
            href={normalize(l.url as string)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-2 transition-colors hover:text-violet-600 hover:underline"
          >
            {l.label}
          </a>
        </Fragment>
      ))}
    </footer>
  );
}

export default LegalLinksFooter;
