import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Clock, Moon, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { attendanceAnalytics } from "@/server/api/attendance/analytics";
import { attendanceSettingsUpdate } from "@/server/api/attendance/settings";
import type { AttendanceAnalytics } from "@/types/gym.types";
import { toast } from "sonner";

const COOLDOWN_OPTIONS = [
  { label: "Once per day", value: "0" },
  { label: "1 hour", value: "60" },
  { label: "3 hours", value: "180" },
  { label: "6 hours", value: "360" },
  { label: "12 hours", value: "720" },
];

export function AttendanceAnalyticsPanel() {
  const queryClient = useQueryClient();
  const analyticsQuery = useQuery<AttendanceAnalytics>({
    queryKey: ["attendance-analytics"],
    queryFn: () => attendanceAnalytics(),
    refetchInterval: 60000,
  });

  const cooldownMutation = useMutation({
    mutationFn: (cooldownMinutes: number) =>
      attendanceSettingsUpdate({ data: { cooldownMinutes } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["attendance-analytics"] });
      toast.success("Check-in cooldown updated");
    },
    onError: () => toast.error("Couldn't update cooldown. Please retry."),
  });

  if (analyticsQuery.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-white shadow-soft animate-pulse" />
        ))}
      </div>
    );
  }

  if (analyticsQuery.isError || !analyticsQuery.data) {
    return (
      <Card className="border-border bg-white shadow-soft">
        <CardContent className="p-6 text-sm text-red-600">
          Couldn&apos;t load attendance analytics.{" "}
          <button onClick={() => analyticsQuery.refetch()} className="font-bold underline">
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const { daily, monthly, peakHours, mostActiveMembers, cooldownMinutes } = analyticsQuery.data;
  // Show business hours (6am–11pm) to keep the chart readable.
  const visiblePeakHours = peakHours.slice(6, 24);

  const stats = [
    {
      title: "Today's Check-ins",
      value: daily.checkInsToday,
      sub: `${daily.deltaVsYesterday >= 0 ? "+" : ""}${daily.deltaVsYesterday} vs yesterday`,
      trend: daily.deltaVsYesterday >= 0 ? "up" : "down",
      icon: Users,
      accent: "bg-primary/10 text-primary",
    },
    {
      title: "This Month",
      value: monthly.checkInsThisMonth,
      sub: `${monthly.activeDays} active days`,
      trend: "neutral" as const,
      icon: CalendarDays,
      accent: "bg-sky-500/10 text-sky-600",
    },
    {
      title: "Avg / Active Day",
      value: monthly.avgPerActiveDay,
      sub: "check-ins per day",
      trend: "neutral" as const,
      icon: Clock,
      accent: "bg-emerald-500/10 text-emerald-600",
    },
    {
      title: "Late Check-ins",
      value: daily.lateToday,
      sub: `${monthly.lateThisMonth} this month`,
      trend: "neutral" as const,
      icon: Moon,
      accent: "bg-amber-500/10 text-amber-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="border-border bg-white shadow-soft hover:shadow-elegant transition-all">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div
                  className={`h-8 w-8 rounded-lg flex items-center justify-center ${stat.accent}`}
                >
                  <stat.icon className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
                <div
                  className={`mt-1 flex items-center gap-1 text-xs font-medium ${
                    stat.trend === "up"
                      ? "text-green-600"
                      : stat.trend === "down"
                        ? "text-red-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {stat.trend === "up" && <ArrowUpRight className="h-3 w-3" />}
                  {stat.trend === "down" && <ArrowDownRight className="h-3 w-3" />}
                  {stat.sub}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-border bg-white shadow-soft">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-900">Peak Hours</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Check-in cooldown</span>
              <Select
                value={String(cooldownMinutes)}
                onValueChange={(value) => cooldownMutation.mutate(Number(value))}
                disabled={cooldownMutation.isPending}
              >
                <SelectTrigger className="h-9 w-[140px] rounded-lg border-slate-200 bg-slate-50 text-slate-900 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {COOLDOWN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="h-[260px] w-full pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visiblePeakHours} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  interval={1}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                  cursor={{ fill: "#7B2CFF08" }}
                />
                <Bar dataKey="value" fill="#7B2CFF" radius={[6, 6, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border bg-white shadow-soft">
          <CardHeader>
            <CardTitle className="text-base font-bold text-slate-900">
              Most Active Members
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mostActiveMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No check-ins recorded this month yet.
              </p>
            ) : (
              mostActiveMembers.map((member, index) => (
                <div key={member.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-center text-sm font-black text-slate-300">
                      {index + 1}
                    </span>
                    <div className="h-9 w-9 rounded-full bg-gradient-brand flex items-center justify-center text-xs font-bold text-white">
                      {member.avatar}
                    </div>
                    <span className="font-bold text-sm text-slate-900">{member.name}</span>
                  </div>
                  <span className="text-sm font-black text-primary">
                    {member.visits}
                    <span className="text-[10px] text-muted-foreground font-bold ml-1 uppercase">
                      visits
                    </span>
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
