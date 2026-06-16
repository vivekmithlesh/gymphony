import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  CreditCard,
  IndianRupee,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dashboardInsights } from "@/server/api/dashboard/insights";
import type { OwnerInsights as OwnerInsightsData } from "@/types/gym.types";

const tooltipStyle = {
  backgroundColor: "#0f172a",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  fontSize: "12px",
} as const;

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
  trend,
  delay,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: typeof Users;
  accent: string;
  trend?: "up" | "down";
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Card className="relative overflow-hidden border-white/10 bg-white/5 backdrop-blur-xl hover:border-primary/30 transition-all">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tracking-tight">{value}</div>
          {sub && (
            <div
              className={`mt-1 flex items-center gap-1 text-xs font-medium ${
                trend === "down"
                  ? "text-red-400"
                  : trend === "up"
                    ? "text-green-400"
                    : "text-muted-foreground"
              }`}
            >
              {trend === "up" && <TrendingUp className="h-3 w-3" />}
              {trend === "down" && <TrendingDown className="h-3 w-3" />}
              {sub}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ChartCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-white/10 bg-white/5 backdrop-blur-xl ${className}`}>
      <CardHeader>
        <CardTitle className="text-base font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[280px] w-full pr-4">{children}</CardContent>
    </Card>
  );
}

export function OwnerInsights() {
  const insightsQuery = useQuery<OwnerInsightsData>({
    queryKey: ["owner-insights"],
    queryFn: () => dashboardInsights(),
    refetchInterval: 60000,
  });

  if (insightsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-white/10 bg-white/5 animate-pulse"
            />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-[340px] rounded-xl border border-white/10 bg-white/5 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-6 text-sm text-red-300">
        Couldn&apos;t load insights right now.{" "}
        <button onClick={() => insightsQuery.refetch()} className="font-bold underline">
          Retry
        </button>
      </div>
    );
  }

  const { cards, attendanceTrend, membershipGrowth, revenueTrend, planDistribution } =
    insightsQuery.data;

  const statCards = [
    {
      title: "Today's Check-ins",
      value: cards.todayCheckIns,
      icon: CalendarCheck,
      accent: "bg-sky-400/10 text-sky-400",
    },
    {
      title: "Active Members",
      value: cards.activeMembers,
      icon: Users,
      accent: "bg-primary/10 text-primary",
    },
    {
      title: "Revenue This Month",
      value: cards.revenueThisMonth,
      icon: IndianRupee,
      accent: "bg-emerald-400/10 text-emerald-400",
    },
    {
      title: "New This Month",
      value: cards.newMembersThisMonth,
      icon: UserPlus,
      accent: "bg-violet-400/10 text-violet-400",
    },
    {
      title: "Renewals Due (7d)",
      value: cards.renewalsDue,
      icon: RefreshCw,
      accent: "bg-amber-400/10 text-amber-400",
    },
    {
      title: "Expiring (30d)",
      value: cards.expiringMemberships,
      icon: AlertTriangle,
      accent: "bg-orange-400/10 text-orange-400",
    },
    {
      title: "Pending Payments",
      value: cards.pendingPayments,
      icon: CreditCard,
      accent: "bg-red-400/10 text-red-400",
    },
    {
      title: "Member Growth",
      value: cards.memberGrowthPercent,
      sub: "vs last month",
      trend: cards.memberGrowthTrend,
      icon: Activity,
      accent: "bg-primary/10 text-primary",
    },
  ] as const;

  return (
    <section className="space-y-6">
      <h2 className="font-display text-2xl font-bold flex items-center gap-2">
        <Activity className="h-6 w-6 text-primary" />
        Business Insights
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card, index) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            sub={"sub" in card ? card.sub : undefined}
            trend={"trend" in card ? card.trend : undefined}
            icon={card.icon}
            accent={card.accent}
            delay={index * 0.05}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Attendance Trend (14 days)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={attendanceTrend}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                interval={2}
              />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#38bdf8" }} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#38bdf8"
                strokeWidth={3}
                dot={false}
                animationDuration={1200}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Membership Growth (6 months)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={membershipGrowth}>
              <defs>
                <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7B2CFF" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7B2CFF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#a78bfa" }} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#7B2CFF"
                strokeWidth={3}
                fill="url(#growthFill)"
                animationDuration={1200}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue Trend (6 months)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueTrend}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  `₹${value >= 1000 ? `${Math.round(value / 1000)}k` : value}`
                }
              />
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={{ color: "#34d399" }}
                formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "Revenue"]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#10b981"
                strokeWidth={3}
                fill="url(#revenueFill)"
                animationDuration={1200}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Plan Distribution">
          {planDistribution.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No active plans yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={planDistribution}
                margin={{ top: 10, right: 10, bottom: 10, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(123,44,255,0.05)" }} />
                <Bar dataKey="count" radius={[8, 8, 0, 0]} barSize={44}>
                  {planDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </section>
  );
}
