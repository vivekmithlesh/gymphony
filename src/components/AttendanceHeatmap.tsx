import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/supabase';
import { debounce } from '@/lib/debounce';
import { useAuth } from '@/lib/auth-context';
import { TrendingUp } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface HourlyPoint {
  hour: string; // '12AM' .. '11PM'
  avg: number;  // average check-ins at this hour per active day
}

// Minimum total check-ins (last 30 days) before we show a chart instead of the
// "not enough data" empty state.
const MIN_CHECKINS = 3;

// X-axis labels matching the 12AM → 11PM design.
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => {
  if (hour === 0) return '12AM';
  if (hour < 12) return `${hour}AM`;
  if (hour === 12) return '12PM';
  return `${hour - 12}PM`;
});

// Sleek tooltip showing the exact average for the hovered hour.
const PeakTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const value = payload[0].value as number;
    return (
      <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-white/10">
        <p className="font-bold tracking-wide">{label}</p>
        <p className="text-purple-300 font-medium">
          {value} avg {value === 1 ? 'check-in' : 'check-ins'}
        </p>
      </div>
    );
  }
  return null;
};

export default function AttendanceHeatmap() {
  const [data, setData] = useState<HourlyPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Stable debounced refetch: a peak-hours rush writes many check-ins; without
  // this each INSERT re-ran the full 30-day scan. fetchRef always points at the
  // latest closure so the debounced wrapper itself never needs recreating.
  const fetchRef = useRef<() => void>(() => {});
  const debouncedRefetchRef = useRef(debounce(() => fetchRef.current(), 800));
  const { user } = useAuth();

  const isAbortError = (error: any) =>
    error?.name === 'AbortError' ||
    error?.message?.includes('abort') ||
    error?.message?.includes('Lock broken');

  const fetchPeakHoursData = async () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    controllerRef.current = new AbortController();
    const signal = controllerRef.current.signal;

    setIsLoading(true);

    try {
      // 1. Resolve the authenticated owner (from global auth) and their gym.
      const ownerId = user?.id;

      if (!ownerId) {
        setData([]);
        return;
      }

      const { data: gymData, error: gymError } = await supabase
        .from('gym_settings')
        .select('id')
        .eq('gym_owner_id', ownerId)
        .maybeSingle();

      if (gymError) throw gymError;
      if (!gymData?.id) {
        setData([]);
        return;
      }

      const gymId = gymData.id;

      // 2. Pull the last 30 days of check-in timestamps for THIS gym directly
      //    via gym_id (RLS also restricts rows to gyms this owner owns).
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: checkIns, error } = await supabase
        .from('check_ins')
        .select('check_in_time, created_at')
        .eq('gym_id', gymId)
        .gte('check_in_time', thirtyDaysAgo.toISOString())
        .abortSignal(signal);

      if (error) {
        if (isAbortError(error)) return;
        throw error;
      }

      // 4. Aggregate: count check-ins per hour, and track distinct active days
      //    so the average reflects a typical *operating* day, not a flat /30.
      const hourCounts = Array<number>(24).fill(0);
      const activeDays = new Set<string>();

      (checkIns || []).forEach((row: { check_in_time?: string; created_at?: string }) => {
        const ts = row.check_in_time || row.created_at;
        if (!ts) return;
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return;
        hourCounts[d.getHours()] += 1;
        activeDays.add(d.toDateString());
      });

      const totalCheckIns = hourCounts.reduce((sum, n) => sum + n, 0);
      if (totalCheckIns < MIN_CHECKINS) {
        setData([]);
        return;
      }

      const days = Math.max(activeDays.size, 1);
      const chartData: HourlyPoint[] = HOUR_LABELS.map((label, hour) => ({
        hour: label,
        avg: Number((hourCounts[hour] / days).toFixed(1)),
      }));

      setData(chartData);

      // 5. Keep it live — refresh when a new check-in lands.
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
      realtimeChannelRef.current = supabase
        .channel(`peak-hours-${gymId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `gym_id=eq.${gymId}` },
          () => debouncedRefetchRef.current()
        )
        .subscribe();
    } catch (error: any) {
      if (isAbortError(error)) return;
      console.warn('Error fetching peak hours data:', error);
      setData([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Keep fetchRef pointed at the latest closure for the debounced realtime refetch.
  fetchRef.current = fetchPeakHoursData;

  useEffect(() => {
    const debounced = debouncedRefetchRef.current;
    fetchPeakHoursData();

    return () => {
      debounced.cancel();
      if (controllerRef.current) controllerRef.current.abort();
      if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current);
    };
    // Re-run once the authenticated owner is known (auth resolves async).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const hasData = data.length > 0 && data.some((d) => d.avg > 0);

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-purple-100 mt-6 min-h-60">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-gray-900">Peak Hours (Average)</h3>
        {hasData && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-600 rounded-full text-xs font-bold border border-green-100">
            <TrendingUp className="h-3 w-3" />
            Live Insights
          </div>
        )}
      </div>

      {isLoading ? (
        // Skeleton loader matching the chart height.
        <div className="h-45">
          <div className="flex items-end justify-between h-40 gap-1.5">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-slate-100 rounded-t-md animate-pulse"
                style={{ height: `${20 + ((i * 37) % 70)}%` }}
              />
            ))}
          </div>
          <div className="h-4 mt-2 bg-slate-50 rounded animate-pulse" />
        </div>
      ) : !hasData ? (
        // Graceful empty state.
        <div className="flex flex-col items-center justify-center h-45 text-center">
          <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
            <TrendingUp className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-600 font-semibold">
            Not enough data to determine peak hours yet
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            Check-ins from your members will populate this chart automatically.
          </p>
        </div>
      ) : (
        // Premium gradient area chart.
        <div className="h-45 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="peakHoursGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="hour"
                interval={0}
                tick={{ fontSize: 9, fill: '#94a3b8', fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip
                content={<PeakTooltip />}
                cursor={{ stroke: '#8b5cf6', strokeWidth: 1, strokeOpacity: 0.3 }}
              />
              <Area
                type="monotone"
                dataKey="avg"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                fill="url(#peakHoursGradient)"
                activeDot={{ r: 4, fill: '#8b5cf6', stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
