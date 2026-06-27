// =============================================================================
// PlatformAdminDashboard — the body of /platform-admin (super-admin overview).
// Rendered inside <AdminRoute>, so it only ever mounts for a platform admin; the
// data behind it is independently admin-gated at the DB (SECURITY DEFINER RPCs).
//
// Sections: A) platform stat cards, B) gym subscription table, C) login activity,
// D) gym detail drawer (GymDetailSheet). Premium purple-gradient theme, fully
// responsive (tables collapse to cards on mobile), dark/light compatible, with
// loading / empty / error states throughout.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  CreditCard,
  Eye,
  Hourglass,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PremiumSyncing } from "@/components/PremiumLoader";
import {
  getAllGymsWithSubscriptionAndMemberCount,
  getPlatformAdminStats,
  getRecentLoginEvents,
  formatDate,
  formatTime,
  formatDateTime,
  type AdminGymRow,
  type AdminLoginEvent,
  type PlatformAdminStats,
} from "@/lib/platform-admin";
import { StatusBadge, TierBadge, billingLabel } from "./shared";
import { GymDetailSheet } from "./GymDetailSheet";

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

interface StatDef {
  key: keyof PlatformAdminStats;
  label: string;
  icon: LucideIcon;
  accent: string; // icon chip background
}

const STAT_DEFS: StatDef[] = [
  { key: "total_gyms", label: "Total Gyms", icon: Building2, accent: "bg-violet-500/15 text-violet-600 dark:text-violet-300" },
  { key: "total_members", label: "Total Members", icon: Users, accent: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300" },
  { key: "active_subscriptions", label: "Active Paid Gyms", icon: ShieldCheck, accent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  { key: "trial_gyms", label: "Trial Gyms", icon: Sparkles, accent: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
  { key: "pending_payments", label: "Pending Payments", icon: Hourglass, accent: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  { key: "expired_subscriptions", label: "Expired / Pending", icon: XCircle, accent: "bg-red-500/15 text-red-600 dark:text-red-300" },
];

function StatCards({ stats, loading }: { stats: PlatformAdminStats | null; loading: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {STAT_DEFS.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.key}
            className="rounded-2xl border border-border bg-card p-4 shadow-soft transition-shadow hover:shadow-elegant"
          >
            <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.accent}`}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">
              {loading || !stats ? <span className="text-muted-foreground">—</span> : stats[s.key].toLocaleString("en-IN")}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small UI
// ---------------------------------------------------------------------------

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" /> {message}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry} className="border-red-300 text-red-600 hover:bg-red-100 dark:border-red-500/40">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

const roleLabel = (r: string | null) =>
  !r ? "—" : r.charAt(0).toUpperCase() + r.slice(1);

// ---------------------------------------------------------------------------
// B) Gyms table
// ---------------------------------------------------------------------------

function GymsSection({
  gyms,
  loading,
  error,
  onRetry,
  onView,
}: {
  gyms: AdminGymRow[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onView: (id: string) => void;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!gyms) return [];
    const term = q.trim().toLowerCase();
    if (!term) return gyms;
    return gyms.filter((g) =>
      [g.gym_name, g.owner_name, g.owner_email].some((v) => (v || "").toLowerCase().includes(term)),
    );
  }, [gyms, q]);

  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (loading || !gyms) return <PremiumSyncing label="Loading gyms…" />;

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search gym, owner or email…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Building2} text={q ? "No gyms match your search." : "No gyms registered yet."} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border lg:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Gym</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Billing</th>
                  <th className="px-4 py-3 text-right">Members</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Last login</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <tr key={g.gym_id} className="border-t border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-semibold text-foreground">{g.gym_name}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{g.owner_name || "—"}</p>
                      <p className="break-all text-xs text-muted-foreground">{g.owner_email || "—"}</p>
                    </td>
                    <td className="px-4 py-3"><TierBadge tier={g.plan_tier} /></td>
                    <td className="px-4 py-3"><StatusBadge row={g} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{billingLabel(g.billing_cycle)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">{g.member_count.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(g.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDateTime(g.last_login)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => onView(g.gym_id)}>
                        <Eye className="mr-1.5 h-3.5 w-3.5" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet cards */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((g) => (
              <div key={g.gym_id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-foreground">{g.gym_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{g.owner_name || "—"}</p>
                    <p className="break-all text-xs text-muted-foreground">{g.owner_email || "—"}</p>
                  </div>
                  <StatusBadge row={g} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <TierBadge tier={g.plan_tier} />
                  <span className="text-muted-foreground">{billingLabel(g.billing_cycle)}</span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> {g.member_count.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Created: {formatDate(g.created_at)}</span>
                  <span>Last login: {formatDate(g.last_login)}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => onView(g.gym_id)} className="mt-3 w-full">
                  <Eye className="mr-1.5 h-3.5 w-3.5" /> View details
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C) Login activity
// ---------------------------------------------------------------------------

function LoginsSection({
  logins,
  loading,
  error,
  onRetry,
}: {
  logins: AdminLoginEvent[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (loading || !logins) return <PremiumSyncing label="Loading login activity…" />;
  if (logins.length === 0) return <EmptyState icon={Users} text="No login activity recorded yet." />;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border lg:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Gym</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {logins.map((l) => (
              <tr key={l.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-4 py-3 break-all font-medium text-foreground">{l.email || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{roleLabel(l.role)}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.gym_name || "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(l.login_at)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatTime(l.login_at)}</td>
                <td className="px-4 py-3 max-w-[16rem] truncate text-muted-foreground" title={l.user_agent || ""}>
                  {l.device || l.user_agent || "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    {l.status || "success"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 lg:hidden">
        {logins.map((l) => (
          <div key={l.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <p className="break-all font-semibold text-foreground">{l.email || "—"}</p>
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {l.status || "success"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {roleLabel(l.role)}{l.gym_name ? ` · ${l.gym_name}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(l.login_at)}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={l.user_agent || ""}>
              {l.device || l.user_agent || "—"}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function PlatformAdminDashboard() {
  const [stats, setStats] = useState<PlatformAdminStats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [gyms, setGyms] = useState<AdminGymRow[] | null>(null);
  const [gymsErr, setGymsErr] = useState<string | null>(null);
  const [logins, setLogins] = useState<AdminLoginEvent[] | null>(null);
  const [loginsErr, setLoginsErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  const loadStats = useCallback(async () => {
    setStatsErr(null);
    try {
      setStats(await getPlatformAdminStats());
    } catch (e) {
      setStatsErr(msg(e, "Could not load platform stats."));
    }
  }, []);

  const loadGyms = useCallback(async () => {
    setGymsErr(null);
    try {
      setGyms(await getAllGymsWithSubscriptionAndMemberCount());
    } catch (e) {
      setGyms([]);
      setGymsErr(msg(e, "Could not load gyms."));
    }
  }, []);

  const loadLogins = useCallback(async () => {
    setLoginsErr(null);
    try {
      setLogins(await getRecentLoginEvents(150));
    } catch (e) {
      setLogins([]);
      setLoginsErr(msg(e, "Could not load login activity."));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([loadStats(), loadGyms(), loadLogins()]);
    setRefreshing(false);
  }, [loadStats, loadGyms, loadLogins]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              <ShieldCheck className="h-3.5 w-3.5" /> Platform Super Admin
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Platform overview</h1>
            <p className="mt-1 text-sm text-white/80">
              Gyms, subscriptions, members and login activity across Gymphony.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void refreshAll()}
              disabled={refreshing}
              className="bg-white/15 text-white hover:bg-white/25"
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/15">
              <Link to="/admin">
                <CreditCard className="mr-1.5 h-4 w-4" /> Billing
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* A) Stat cards */}
      {statsErr ? (
        <SectionError message={statsErr} onRetry={() => void loadStats()} />
      ) : (
        <StatCards stats={stats} loading={refreshing && !stats} />
      )}

      {/* B + C) Tabs */}
      <Tabs defaultValue="gyms" className="w-full">
        <TabsList>
          <TabsTrigger value="gyms">
            <Building2 className="mr-1.5 h-4 w-4" /> Gyms
            {gyms ? <span className="ml-1.5 text-xs text-muted-foreground">({gyms.length})</span> : null}
          </TabsTrigger>
          <TabsTrigger value="logins">
            <Users className="mr-1.5 h-4 w-4" /> Login activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gyms" className="mt-4">
          <GymsSection
            gyms={gyms}
            loading={refreshing && !gyms}
            error={gymsErr}
            onRetry={() => void loadGyms()}
            onView={openDetail}
          />
        </TabsContent>

        <TabsContent value="logins" className="mt-4">
          <LoginsSection
            logins={logins}
            loading={refreshing && !logins}
            error={loginsErr}
            onRetry={() => void loadLogins()}
          />
        </TabsContent>
      </Tabs>

      {/* D) Detail drawer */}
      <GymDetailSheet gymId={detailId} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}

export default PlatformAdminDashboard;
