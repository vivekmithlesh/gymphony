import { Phone, Mail, MapPin } from "lucide-react";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              The all-in-one gym management platform built to help ambitious owners automate operations and grow membership.
            </p>
            <div className="mt-6 space-y-2 text-sm">
              <p className="font-semibold">Founder · Vivek Kumar</p>
              <a
                href="tel:7906240659"
                className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
              >
                <Phone className="h-4 w-4" /> +91 79062 40659
              </a>
              <a
                href="tel:9624790088"
                className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
              >
                <Phone className="h-4 w-4" /> +91 96247 90088
              </a>
              <a
                href="mailto:hello@gymphony.app"
                className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
              >
                <Mail className="h-4 w-4" /> hello@gymphony.app
              </a>
              <p className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" /> India
              </p>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold">Product</h4>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li><a href="#features" className="hover:text-primary">Features</a></li>
              <li><a href="#preview" className="hover:text-primary">App Preview</a></li>
              <li><a href="#marketing" className="hover:text-primary">Discovery</a></li>
              <li><a href="#pricing" className="hover:text-primary">Pricing</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold">Company</h4>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li><a href="#cta" className="hover:text-primary">Contact</a></li>
              <li><a href="#cta" className="hover:text-primary">Book Demo</a></li>
              <li><a href="#cta" className="hover:text-primary">Free Trial</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 text-sm text-muted-foreground md:flex-row">
          <p>© {new Date().getFullYear()} Gymphony. All rights reserved.</p>
          <p>Built with ❤️ for gym owners.</p>
        </div>
      </div>
    </footer>
  );
}
