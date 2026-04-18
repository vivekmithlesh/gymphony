import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";

const links = [
  { href: "#features", label: "Features" },
  { href: "#preview", label: "Product" },
  { href: "#marketing", label: "Discovery" },
  { href: "#pricing", label: "Pricing" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? "border-b border-border/60 bg-background/80 backdrop-blur-xl"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="#top" className="flex items-center">
          <Logo />
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href="#cta"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </a>
          <a
            href="#cta"
            className="rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:shadow-elegant hover:-translate-y-0.5"
          >
            Start Free Trial
          </a>
        </div>

        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg p-2 md:hidden"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/60 bg-background/95 backdrop-blur-xl md:hidden">
          <div className="flex flex-col gap-1 p-4">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-3 text-sm font-medium text-foreground hover:bg-accent"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#cta"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-full bg-gradient-brand px-5 py-3 text-center text-sm font-semibold text-primary-foreground shadow-soft"
            >
              Start Free Trial
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
