import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ScanLine, ShieldCheck, ShieldAlert, RefreshCw, Crown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { usePlanAccess } from "@/lib/usePlanAccess";
import { PLANS, requiredTierFor } from "@/lib/plans";

interface ScanRow {
  id: string;
  member_id: string | null;
  result: string; // granted | denied | forged | expired | wrong_gym | invalid
  reason: string | null;
  source: string | null;
  created_at: string;
}

const FEATURE = "attendance_insights" as const;
const BLOCKED = new Set(["forged", "expired", "wrong_gym", "invalid"]);

const RESULT_STYLE: Record<string, { label: string; cls: string }> = {
  granted: { label: "Granted", cls: "bg-emerald-50 text-emerald-700" },
  denied: { label: "Denied", cls: "bg-amber-50 text-amber-700" },
  forged: { label: "Forged", cls: "bg-red-50 text-red-600" },
  expired: { label: "Expired", cls: "bg-orange-50 text-orange-600" },
  wrong_gym: { label: "Wrong gym", cls: "bg-red-50 text-red-600" },
  invalid: { label: "Invalid", cls: "bg-slate-100 text-slate-600" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * QR Scan Analytics — read-only owner view over the qr_scans audit log written
 * by kiosk_check_in (Wave 2). Gated to Growth via the same SSOT as every other
 * feature; the data query only runs when the owner is entitled, so a locked
 * Starter gym never fetches it.
 */
export function QrScanAnalytics() {
  const { user } = useAuth();
  const { isLoading: planLoading, hasAccess } = usePlanAccess();
  const allowed = hasAccess(FEATURE);

  const [scans, setScans] = useState<ScanRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchScans = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // RLS also restricts to this owner; the filter keeps the payload small.
      const { data, error } = await supabase
        .from("qr_scans")
        .select("id, member_id, result, reason, source, created_at")
        .eq("kiosk_owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.warn("qr_scans fetch error:", error.message);
        return;
      }
      const rows = (data as ScanRow[]) || [];
      setScans(rows);

      const ids = Array.from(new Set(rows.map((r) => r.member_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: members } = await supabase
          .from("members")
          .select("id, full_name")
          .in("id", ids);
        const map: Record<string, string> = {};
        members?.forEach((m: any) => m.full_name && (map[m.id] = m.full_name));
        setNames(map);
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (allowed) fetchScans();
  }, [allowed, fetchScans]);

  const stats = useMemo(() => {
    let granted = 0,
      denied = 0,
      blocked = 0;
    for (const s of scans) {
      if (s.result === "granted") granted++;
      else if (s.result === "denied") denied++;
      else if (BLOCKED.has(s.result)) blocked++;
    }
    return { total: scans.length, granted, denied, blocked };
  }, [scans]);

  if (planLoading) return null;

  // Locked (Starter): a compact upgrade teaser — no data is fetched.
  if (!allowed) {
    const planName = PLANS[requiredTierFor(FEATURE)].name;
    return (
      <Card className="border-slate-200 bg-white shadow-soft">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Crown className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="font-bold text-slate-900">QR Scan Analytics</p>
            <p className="text-sm text-muted-foreground">
              See every kiosk scan — granted, denied and blocked — on the {planName} plan.
            </p>
          </div>
          <Link
            to="/dashboard"
            search={{ tab: "Settings", section: "Billing & Plans" } as never}
            className="rounded-xl bg-gradient-brand px-5 py-2.5 text-sm font-bold text-white"
          >
            Upgrade to {planName}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-white shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
          <ScanLine className="h-5 w-5 text-primary" />
          QR Scan Analytics
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchScans}
          disabled={loading}
          className="h-8 gap-1 rounded-lg"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total scans" value={stats.total} />
          <Stat
            label="Granted"
            value={stats.granted}
            tone="text-emerald-600"
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
          />
          <Stat label="Denied" value={stats.denied} tone="text-amber-600" />
          <Stat
            label="Blocked"
            value={stats.blocked}
            tone="text-red-600"
            icon={<ShieldAlert className="h-3.5 w-3.5" />}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Recent scans
          </p>
          {scans.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No kiosk scans yet."}
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
              {scans.slice(0, 30).map((s) => {
                const style = RESULT_STYLE[s.result] ?? {
                  label: s.result,
                  cls: "bg-slate-100 text-slate-600",
                };
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {s.member_id ? names[s.member_id] || "Member" : "Unknown pass"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.reason || s.source || "kiosk"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {timeAgo(s.created_at)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.cls}`}
                      >
                        {style.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "text-slate-900",
  icon,
}: {
  label: string;
  value: number;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

export default QrScanAnalytics;
