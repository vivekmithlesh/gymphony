import { useEffect, useMemo, useState } from "react";
import { Phone } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PHONE_COUNTRY_CODES,
  cleanPhoneInput,
  e164ToDisplayParts,
  normalizeToE164Phone,
} from "@/lib/phone";

interface InternationalPhoneInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  defaultCountryCode?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

export function InternationalPhoneInput({
  id,
  label,
  value,
  onChange,
  placeholder = "Enter phone number",
  error,
  defaultCountryCode = "+1",
  className = "",
  inputClassName = "",
  disabled = false,
}: InternationalPhoneInputProps) {
  const initialParts = useMemo(() => e164ToDisplayParts(value, defaultCountryCode), [value, defaultCountryCode]);
  const [countryCode, setCountryCode] = useState(initialParts.countryCode);
  const [localNumber, setLocalNumber] = useState(initialParts.localNumber);

  useEffect(() => {
    const nextParts = e164ToDisplayParts(value, defaultCountryCode);
    setCountryCode(nextParts.countryCode);
    setLocalNumber(nextParts.localNumber);
  }, [value, defaultCountryCode]);

  const updatePhone = (nextCountryCode: string, nextLocalNumber: string) => {
    const digitsOnly = nextLocalNumber.replace(/\D/g, "");
    setCountryCode(nextCountryCode);
    setLocalNumber(digitsOnly);
    onChange(normalizeToE164Phone(`${nextCountryCode}${digitsOnly}`, nextCountryCode));
  };

  const handleLocalChange = (nextValue: string) => {
    const cleaned = cleanPhoneInput(nextValue);

    if (cleaned.startsWith("+")) {
      const normalized = normalizeToE164Phone(cleaned, countryCode);
      if (normalized) {
        onChange(normalized);
        const nextParts = e164ToDisplayParts(normalized, countryCode);
        setCountryCode(nextParts.countryCode);
        setLocalNumber(nextParts.localNumber);
      } else {
        onChange(cleaned);
        setLocalNumber(cleaned.replace(/\D/g, ""));
      }
      return;
    }

    updatePhone(countryCode, cleaned);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <Label htmlFor={id} className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">
        {label}
      </Label>
      <div className="flex gap-2">
        <Select value={countryCode} onValueChange={(next) => updatePhone(next, localNumber)} disabled={disabled}>
          <SelectTrigger className="w-37.5 h-12 bg-white/5 border-white/10 rounded-xl text-slate-900">
            <SelectValue placeholder="Code" />
          </SelectTrigger>
          <SelectContent className="bg-white border-slate-200 text-slate-900 max-h-72">
            {PHONE_COUNTRY_CODES.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            id={id}
            type="tel"
            value={localNumber}
            onChange={(event) => handleLocalChange(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${error ? "border-red-500" : ""} ${inputClassName}`}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}