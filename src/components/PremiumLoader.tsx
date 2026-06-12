import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The app's single source of truth for "we're loading" UI, modelled exactly on
 * the Owner Dashboard's overlay (src/routes/dashboard.tsx): a dark glass card
 * with the brand-purple spinner, a bold title and a muted subtext.
 *
 * Use <PremiumLoader/> for full-page / full-section blocking states, and
 * <PremiumSyncing/> for the inline "Syncing..." token that lives inside a card
 * while its own data refreshes.
 */
interface PremiumLoaderProps {
  /** Bold header line. */
  title?: string;
  /** Muted secondary line under the title. */
  subtext?: string;
  /**
   * Full-screen (dark slate backdrop, min-h-screen) vs. inline — inline drops
   * the backdrop so the same card can sit inside a tab/section while it loads.
   */
  fullScreen?: boolean;
  className?: string;
}

export function PremiumLoader({
  title = "Loading",
  subtext = "Please wait a moment…",
  fullScreen = true,
  className,
}: PremiumLoaderProps) {
  const card = (
    <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
      <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-300">{subtext}</p>
    </div>
  );

  if (!fullScreen) {
    return (
      <div className={cn("flex w-full items-center justify-center py-16", className)}>
        {card}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white",
        className,
      )}
    >
      {card}
    </div>
  );
}

/**
 * The inline micro-loader for individual cards — the brand-purple spinner plus
 * the muted, italic "Syncing…" token used on the Owner Dashboard stat cards.
 * Drop-in replacement for the old raw blue/indigo <Loader2/> spinners.
 */
export function PremiumSyncing({
  label = "Syncing…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-4", className)}>
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <span className="text-sm italic text-muted-foreground">{label}</span>
    </div>
  );
}
