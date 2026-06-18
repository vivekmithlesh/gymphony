import { Phone } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatIndianLocalInput } from "@/lib/phone";

interface IndianMobileInputProps {
  id: string;
  label: string;
  /** The 10-digit local number (digits only, no +91). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

/**
 * India-only mobile input: a fixed, non-editable +91 prefix plus a box that
 * accepts at most 10 digits and silently strips anything that isn't a digit
 * (letters, symbols, spaces, a pasted +91/0 prefix). It always emits the
 * canonical 10-digit local number, so callers validate with `isValidIndianMobile`
 * and store with `toIndianE164`.
 */
export function IndianMobileInput({
  id,
  label,
  value,
  onChange,
  placeholder = "9876543210",
  error,
  className = "",
  inputClassName = "",
  disabled = false,
}: IndianMobileInputProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label
        htmlFor={id}
        className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors"
      >
        {label}
      </Label>
      <div className="flex gap-2">
        <div className="flex h-12 shrink-0 items-center rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold text-foreground/80 select-none">
          +91
        </div>

        <div className="relative flex-1">
          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            value={value}
            onChange={(event) => onChange(formatIndianLocalInput(event.target.value))}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={!!error}
            className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${error ? "border-red-500" : ""} ${inputClassName}`}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
