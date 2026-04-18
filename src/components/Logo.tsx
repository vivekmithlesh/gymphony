type Props = { className?: string; showText?: boolean };

export function Logo({ className = "", showText = true }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand shadow-soft">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-primary-foreground">
          {/* Dumbbell */}
          <rect x="2" y="9" width="2.5" height="6" rx="1" fill="currentColor" />
          <rect x="19.5" y="9" width="2.5" height="6" rx="1" fill="currentColor" />
          <rect x="5" y="11" width="14" height="2" rx="1" fill="currentColor" opacity="0.5" />
          {/* Checkmark */}
          <path
            d="M8.5 12.2l2.3 2.3L16 9.3"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {showText && (
        <span className="text-xl font-bold tracking-tight">
          Gym<span className="text-gradient-brand">phony</span>
        </span>
      )}
    </div>
  );
}
