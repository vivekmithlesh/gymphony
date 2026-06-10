import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/supabase";

export type GymLiveStats = {
  /** Calories burned by this gym's members TODAY. */
  todayCalories: number;
  /** Distinct members who logged a workout today. */
  activeToday: number;
  /** Distinct members who checked in today. */
  membersLoggedIn: number;
};

const ZERO: GymLiveStats = { todayCalories: 0, activeToday: 0, membersLoggedIn: 0 };

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/**
 * Live "today" stats for a single gym's public profile (Total Calories /
 * Active Today / Members Logged In).
 *
 * Preferred path is the SECURITY DEFINER `get_gym_today_stats` RPC so any viewer
 * gets accurate aggregates regardless of the per-gym RLS on workout_logs /
 * check_ins. Falls back to a best-effort client aggregation if the RPC isn't
 * deployed. Kept fresh by realtime subscriptions on this gym's rows, with a
 * 30s safety poll so the numbers tick even if a realtime event is missed.
 */
export function useGymLiveStats(gymId?: string) {
  const [stats, setStats] = useState<GymLiveStats>(ZERO);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchStats = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!gymId) return;
      if (!opts?.silent) setIsLoading(true);

      try {
        const { data, error } = await supabase.rpc("get_gym_today_stats", { p_gym: gymId });
        const row = Array.isArray(data) ? data[0] : data;
        if (!error && row) {
          setStats({
            todayCalories: toNumber(row.today_calories),
            activeToday: toNumber(row.active_today),
            membersLoggedIn: toNumber(row.members_logged_in),
          });
          return;
        }

        // Fallback: client-side aggregation (works for the viewer's own gym).
        const since = startOfToday();
        const [logsRes, checkinsRes] = await Promise.all([
          supabase
            .from("workout_logs")
            .select("calories_burned, member_id, user_id")
            .eq("gym_id", gymId)
            .gte("created_at", since),
          supabase.from("check_ins").select("member_id").eq("gym_id", gymId).gte("check_in_time", since),
        ]);

        const logs = logsRes.data ?? [];
        const checkins = checkinsRes.data ?? [];
        const activeMembers = new Set<string>();
        let calories = 0;
        for (const log of logs) {
          calories += toNumber(log.calories_burned);
          const who = log.member_id ?? log.user_id;
          if (who) activeMembers.add(String(who));
        }
        const checkedIn = new Set<string>();
        for (const c of checkins) if (c.member_id) checkedIn.add(String(c.member_id));

        setStats({
          todayCalories: calories,
          activeToday: activeMembers.size,
          membersLoggedIn: checkedIn.size,
        });
      } catch (err) {
        console.error("Gym live stats fetch failed:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [gymId],
  );

  // Debounced refresh so a burst of realtime events triggers one fetch.
  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void fetchStats({ silent: true }), 400);
  }, [fetchStats]);

  useEffect(() => {
    if (!gymId) return;
    void fetchStats();

    const channel = supabase
      .channel(`gym-live-stats-${gymId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workout_logs", filter: `gym_id=eq.${gymId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "check_ins", filter: `gym_id=eq.${gymId}` },
        refresh,
      )
      .subscribe();

    // Safety poll: RLS may withhold realtime events for visitors of other gyms.
    const interval = setInterval(() => void fetchStats({ silent: true }), 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [gymId, fetchStats, refresh]);

  return { stats, isLoading };
}
