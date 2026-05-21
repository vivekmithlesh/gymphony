import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/supabase';
import { Loader2, TrendingUp } from 'lucide-react';

interface HourlyData {
  hour: string;
  count: number;
  level: number; // percentage for the bar height
}

interface GymSettings {
  id: string;
  gym_owner_id?: string | null;
}

export default function AttendanceHeatmap() {
  const [data, setData] = useState<HourlyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const heatmapControllerRef = useRef<AbortController | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const hourLabels = Array.from({ length: 24 }, (_, hour) => {
    if (hour === 0) return '12am';
    if (hour < 12) return `${hour}am`;
    if (hour === 12) return '12pm';
    return `${hour - 12}pm`;
  });

  const fetchPeakHoursData = async () => {
    if (heatmapControllerRef.current) {
      heatmapControllerRef.current.abort();
    }
    heatmapControllerRef.current = new AbortController();

    setIsLoading(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const ownerId = sessionData.session?.user?.id;

      if (!ownerId) {
        setData([]);
        return;
      }

      const { data: gymData, error: gymError } = await supabase
        .from('gym_settings')
        .select('id')
        .eq('gym_owner_id', ownerId)
        .maybeSingle();

      if (gymError) {
        throw gymError;
      }

      if (!gymData?.id) {
        setData([]);
        return;
      }

      const gymId = gymData.id;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: workoutLogs, error } = await supabase
        .from('workout_logs')
        .select('created_at')
        .eq('gym_id', gymId)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .abortSignal(heatmapControllerRef.current.signal);

      if (error) {
        if (
          error.name === 'AbortError' ||
          error.message?.includes('abort') ||
          error.message?.includes('Lock broken')
        ) {
          return;
        }
        throw error;
      }

      const logCount = workoutLogs?.length || 0;
      if (logCount < 5) {
        setData([]);
        return;
      }

      const hourCounts: Record<number, number> = {};
      hourLabels.forEach((_, hour) => {
        hourCounts[hour] = 0;
      });

      (workoutLogs || []).forEach((log: { created_at: string }) => {
        const date = new Date(log.created_at);
        const hour = date.getHours();
        if (hourCounts[hour] !== undefined) {
          hourCounts[hour] += 1;
        }
      });

      const daysObserved = 30;
      const hourlyAverages = hourLabels.map((label, hour) => {
        const avgCount = Number((hourCounts[hour] / daysObserved).toFixed(1));
        return {
          hour: label,
          count: avgCount,
          level: 0,
        };
      });

      const maxAverage = Math.max(...hourlyAverages.map((entry) => entry.count), 0);
      const formattedData = hourlyAverages.map((entry) => ({
        ...entry,
        level: maxAverage > 0 ? (entry.count / maxAverage) * 100 : 0,
      }));

      setData(formattedData);

      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }

      realtimeChannelRef.current = supabase
        .channel(`peak-hours-${gymId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'workout_logs', filter: `gym_id=eq.${gymId}` },
          () => {
            fetchPeakHoursData();
          }
        )
        .subscribe();
    } catch (error: any) {
      if (
        error.name === 'AbortError' ||
        error.message?.includes('abort') ||
        error.message?.includes('Lock broken')
      ) {
        return;
      }
      console.warn('Error fetching peak hours data:', error);
      setData([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPeakHoursData();

    return () => {
      if (heatmapControllerRef.current) {
        heatmapControllerRef.current.abort();
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-purple-100 mt-6 h-60 flex flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
        <p className="text-sm text-muted-foreground">Calculating peak hours...</p>
      </div>
    );
  }

  const hasData = data.some(d => d.count > 0);
  const hasEnoughData = data.length > 0;

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

      {!hasEnoughData ? (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
            <TrendingUp className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-500 font-medium">Collecting more data to show peak hours accurately</p>
          <p className="text-[11px] text-slate-400 mt-1">We need at least 5 workout logs from your gym to calculate meaningful averages.</p>
        </div>
      ) : (
        <div className="flex items-end justify-between h-32 gap-1 md:gap-2">
          {data.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2">
              <div 
                className={`w-full rounded-t-lg relative group transition-all duration-500 ease-out ${
                  d.count > 0 ? 'bg-purple-500 hover:bg-purple-600' : 'bg-slate-100'
                }`}
                style={{ height: `${Math.max(d.level, 4)}%` }} // Minimum height of 4% for visibility
              >
                {d.count > 0 && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                    {d.count} {d.count === 1 ? 'check-in' : 'check-ins'}
                  </div>
                )}
              </div>
              <span className="text-[8px] md:text-[10px] font-bold text-gray-400 uppercase">{d.hour}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
