import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// A robust 12-hour AM/PM time picker. It reads and writes a 24-hour "HH:MM"
// string (the format already stored in gym_settings.opening_time/closing_time),
// so the database format and existing data are unchanged — only the UI gains a
// clear hour / minute / AM-PM selection instead of a locale-dependent native one.

interface TimePickerProps {
  value?: string | null; // "HH:MM" 24-hour
  onChange: (value: string) => void;
  className?: string;
}

function parse(value?: string | null) {
  const [hStr, mStr] = (value || "").split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return { hour12: "", minute: "", period: "AM" as "AM" | "PM" };
  }
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { hour12: String(hour12), minute: String(m).padStart(2, "0"), period };
}

function to24(hour12: string, minute: string, period: "AM" | "PM") {
  let h = Number(hour12) % 12;
  if (period === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const triggerClass = "h-12 rounded-xl border-slate-200 bg-slate-50";

export function TimePicker({ value, onChange, className }: TimePickerProps) {
  const { hour12, minute, period } = parse(value);

  // Only emit once we have both an hour and a minute (a complete time).
  const emit = (h: string, m: string, p: "AM" | "PM") => {
    if (h && m) onChange(to24(h, m, p));
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Select value={hour12} onValueChange={(h) => emit(h, minute || "00", period)}>
        <SelectTrigger className={triggerClass} aria-label="Hour">
          <SelectValue placeholder="Hr" />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {HOURS.map((h) => (
            <SelectItem key={h} value={h}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="font-bold text-slate-400">:</span>

      <Select value={minute} onValueChange={(m) => emit(hour12 || "12", m, period)}>
        <SelectTrigger className={triggerClass} aria-label="Minute">
          <SelectValue placeholder="Min" />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={period} onValueChange={(p) => emit(hour12 || "12", minute || "00", p as "AM" | "PM")}>
        <SelectTrigger className={`${triggerClass} w-20`} aria-label="AM or PM">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export default TimePicker;
