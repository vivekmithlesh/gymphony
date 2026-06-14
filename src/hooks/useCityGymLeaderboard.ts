import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/supabase";

export type GymLeaderboardEntry = {
  gym_id: string;
  rank: number;
  gym_name: string;
  logo_url: string | null;
  /** The ranking metric: total calories burned by the gym's members THIS MONTH. */
  vibe_points: number;
  city: string;
  latitude: number | null;
  longitude: number | null;
  email: string | null;
  mobile_number: string | null;
  /** Active members + this month's check-ins, for the map popup stats. */
  active_members: number;
  checkins: number;
  /** flips briefly when a member of this gym logs a workout (drives the pulse) */
  is_active: boolean;
};

type GymSettingsRow = {
  id: string;
  gym_name?: string | null;
  city?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  logo_url?: string | null;
  owner_email?: string | null;
  contact_number?: string | null;
};

type WorkoutLogRow = { gym_id?: string | null; calories_burned?: number | string | null };
type GymProfileRow = {
  gym_id?: string | null;
  id?: string | null;
  vibe_points?: number | string | null;
};

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const toCoord = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/**
 * City-wide GYM leaderboard. Ranks every gym in `city` by its Total Vibe Score
 * — the sum of calories burned by all of that gym's members. Keyed strictly by
 * gym_settings.id so a gym can never appear twice, and kept live by subscribing
 * to workout_logs.
 */
export function useCityGymLeaderboard(city: string = "ALIGARH") {
  const [leaderboard, setLeaderboard] = useState<GymLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeGymsRef = useRef<Set<string>>(new Set());
  // Gyms the SERVER reports as active (workout in the last ~12 min). This makes
  // every active gym pulse for all viewers, not just on realtime events the
  // viewer is allowed by RLS to receive.
  const serverActiveRef = useRef<Set<string>>(new Set());
  const activeTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const [pulseVersion, setPulseVersion] = useState(0);

  const fetchLeaderboard = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setIsLoading(true);

      // Preferred path: server-side monthly aggregation (calories + active members
      // + check-ins), ranked. SECURITY DEFINER so it can read across gyms safely.
      const { data: rpcData, error: rpcError } = await supabase.rpc("get_city_gym_leaderboard", {
        p_city: city,
      });

      if (!rpcError && Array.isArray(rpcData)) {
        // Refresh the server-active set so the pulse reflects real recent activity.
        const nextServerActive = new Set<string>();
        for (const r of rpcData as any[]) {
          if (r.is_active) nextServerActive.add(String(r.gym_id));
        }
        serverActiveRef.current = nextServerActive;

        const entries: GymLeaderboardEntry[] = (rpcData as any[])
          .map((r) => {
            const id = String(r.gym_id);
            return {
              gym_id: id,
              rank: 0,
              gym_name: (r.gym_name || "Unknown Gym").trim(),
              logo_url: r.logo_url || null,
              vibe_points: toNumber(r.monthly_calories),
              city: (r.city || "ALIGARH").trim(),
              latitude: toCoord(r.latitude),
              longitude: toCoord(r.longitude),
              email: null,
              mobile_number: null,
              active_members: toNumber(r.active_members),
              checkins: toNumber(r.monthly_checkins),
              // Active = server says "recently worked out" OR a live realtime pulse.
              is_active: Boolean(r.is_active) || activeGymsRef.current.has(id),
            };
          })
          .map((e, i) => ({ ...e, rank: i + 1 }));
        setLeaderboard(entries);
        return;
      }

      // Server-side plan gate denied access (below Growth). Honour the boundary —
      // do NOT fall back to client-side cross-gym aggregation.
      if (rpcError) {
        const code = (rpcError as { code?: string }).code;
        const msg = String((rpcError as { message?: string }).message || "");
        if (code === "42501" || msg.includes("leaderboard_requires_growth")) {
          setLeaderboard([]);
          return;
        }
      }

      // Fallback (RPC not deployed yet): client-side monthly aggregation.
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      // gym_settings is the single source of identity (id, name, coords, logo).
      // Aggregating from here guarantees one row per real gym — no duplicates.
      const [gymsRes, logsRes, profilesRes] = await Promise.all([
        supabase
          .from("gym_settings")
          .select("id, gym_name, city, latitude, longitude, logo_url, owner_email, contact_number"),
        supabase
          .from("workout_logs")
          .select("gym_id, calories_burned")
          .gte("created_at", monthStart.toISOString()),
        // Legacy fallback score so a gym with vibe_points but no logs isn't shown as 0.
        supabase.from("gym_profiles").select("id, gym_id, vibe_points"),
      ]);

      const gyms = (gymsRes.data as GymSettingsRow[] | null) ?? [];
      const logs = (logsRes.data as WorkoutLogRow[] | null) ?? [];
      const profiles = (profilesRes.data as GymProfileRow[] | null) ?? [];

      // Sum member calories per gym.
      const burnByGym = new Map<string, number>();
      for (const log of logs) {
        if (!log.gym_id) continue;
        const key = String(log.gym_id);
        burnByGym.set(key, (burnByGym.get(key) || 0) + toNumber(log.calories_burned));
      }

      // Legacy vibe_points keyed by either id or gym_id.
      const legacyByGym = new Map<string, number>();
      for (const p of profiles) {
        const key = p.gym_id ? String(p.gym_id) : p.id ? String(p.id) : null;
        if (!key) continue;
        legacyByGym.set(key, Math.max(legacyByGym.get(key) || 0, toNumber(p.vibe_points)));
      }

      const target = city.trim().toUpperCase();

      const entries: GymLeaderboardEntry[] = gyms
        .map((g) => {
          const id = String(g.id);
          const burn = burnByGym.get(id) || 0;
          const legacy = legacyByGym.get(id) || 0;
          return {
            gym_id: id,
            rank: 0,
            gym_name: (g.gym_name || "Unknown Gym").trim(),
            logo_url: g.logo_url || null,
            vibe_points: Math.max(burn, legacy),
            city: (g.city || "ALIGARH").trim(),
            latitude: toCoord(g.latitude),
            longitude: toCoord(g.longitude),
            email: g.owner_email ?? null,
            mobile_number: g.contact_number ?? null,
            active_members: 0,
            checkins: 0,
            is_active: activeGymsRef.current.has(id),
          };
        })
        // Case-insensitive city filter; blank city defaults into ALIGARH.
        .filter((e) => {
          const c = e.city.toUpperCase();
          return c === target || (target === "ALIGARH" && (c === "" || c === "ALIGARH"));
        })
        .sort((a, b) => b.vibe_points - a.vibe_points || a.gym_name.localeCompare(b.gym_name))
        .map((e, i) => ({ ...e, rank: i + 1 }));

      setLeaderboard(entries);
    } catch (error) {
      console.error("City gym leaderboard fetch failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [city]);

  const refresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => void fetchLeaderboard({ silent: true }), 400);
  }, [fetchLeaderboard]);

  const pulseGym = useCallback((gymId: string) => {
    const key = String(gymId);
    activeGymsRef.current.add(key);
    setPulseVersion((v) => v + 1);

    const existing = activeTimersRef.current.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      activeGymsRef.current.delete(key);
      activeTimersRef.current.delete(key);
      setPulseVersion((v) => v + 1);
    }, 6000);
    activeTimersRef.current.set(key, timer);
  }, []);

  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    const channel = supabase
      .channel(`city-gym-leaderboard-${city.toLowerCase()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workout_logs" },
        (payload) => {
          const row = (payload.new ?? payload.old) as WorkoutLogRow | undefined;
          if (row?.gym_id) pulseGym(String(row.gym_id));
          refresh();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "gym_settings" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "gym_profiles" }, refresh)
      .subscribe((status) => setIsRealtimeConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      activeTimersRef.current.forEach((t) => clearTimeout(t));
      activeTimersRef.current.clear();
      activeGymsRef.current.clear();
      serverActiveRef.current.clear();
    };
  }, [city, pulseGym, refresh]);

  useEffect(() => {
    setLeaderboard((prev) =>
      prev.map((e) => ({
        ...e,
        // Server "recently active" OR a fresh realtime pulse.
        is_active: serverActiveRef.current.has(e.gym_id) || activeGymsRef.current.has(e.gym_id),
      })),
    );
  }, [pulseVersion]);

  // Periodic silent refresh so the server is_active flag decays (a gym idle for
  // >12 min stops pulsing) even when no realtime events are arriving.
  useEffect(() => {
    const interval = setInterval(() => void fetchLeaderboard({ silent: true }), 60_000);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  return { leaderboard, isLoading, isRealtimeConnected, refresh: fetchLeaderboard };
}
