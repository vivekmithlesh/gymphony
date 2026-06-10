import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/supabase";
import { toast } from "sonner";

export type LeaderboardEntry = {
  rank: number;
  gym_name: string;
  logo_url: string;
  gym_photos: string[];
  total_score: number;
  vibe_points: number;
  city: string;
  gym_id?: string | null;
  gym_owner_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  email?: string | null;
  mobile_number?: string | null;
  is_active?: boolean;
};

type LeaderboardRow = {
  id?: string | number;
  gym_id?: string | number;
  gym_owner_id?: string | null;
  gym_name?: string;
  name?: string;
  logo_url?: string | null;
  total_score?: number | string;
  total_calories?: number | string;
  calories?: number | string;
  vibe_points?: number | string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  city?: string;
};

const normalizeScore = (value: unknown) => {
  const score = Number(value ?? 0);
  return Number.isFinite(score) ? score : 0;
};

const normalizeCoordinates = (value: unknown) => {
  const coordinate = Number(value ?? 0);
  return Number.isFinite(coordinate) ? coordinate : null;
};

const buildEntries = (rows: LeaderboardRow[]): LeaderboardEntry[] =>
  rows
    .map((row, index) => ({
      rank: index + 1,
      gym_name: row.gym_name?.trim() || row.name?.trim() || `Gym ${index + 1}`,
      logo_url: row.logo_url || "",
      gym_photos: [],
      total_score: normalizeScore(row.total_score ?? row.total_calories ?? row.calories),
      vibe_points: normalizeScore(row.vibe_points ?? row.total_score ?? row.total_calories ?? row.calories),
      city: row.city || "ALIGARH",
      gym_id: row.gym_id ? String(row.gym_id) : (row.id ? String(row.id) : null),
      gym_owner_id: row.gym_owner_id ?? null,
      latitude: normalizeCoordinates(row.latitude ?? row.lat),
      longitude: normalizeCoordinates(row.longitude ?? row.lng),
      is_active: false,
    }))
    .sort((left, right) => right.total_score - left.total_score)
    .map((row, index) => ({ ...row, rank: index + 1 }));

/**
 * Custom hook for real-time leaderboard updates
 * Subscribes to workout_logs table and refreshes leaderboard on new logs
 * @param city - City to fetch leaderboard for (default: "ALIGARH")
 * @param enableRealtime - Enable real-time subscription (default: true)
 */
export function useRealtimeLeaderboard(city: string = "ALIGARH", enableRealtime: boolean = true) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
    const [logoVersion, setLogoVersion] = useState(0);
  const [pulseVersion, setPulseVersion] = useState(0);
  const subscriptionRef = useRef<any>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeGymsRef = useRef<Set<string>>(new Set());
  const activeGymTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Fetch leaderboard data
  const fetchLeaderboard = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('DEBUG: Fetching leaderboard for city:', city);

      // Step 1: Fetch from gym_leaderboard view (Real-time rankings)
      console.log('DEBUG: Attempting to fetch from gym_leaderboard view...');
      let viewData: any[] = [];
      try {
        const { data, error } = await supabase
          .from("gym_leaderboard")
          .select("gym_id, vibe_points, rank, gym_name")
          .order("vibe_points", { ascending: false })
          .limit(100);

        if (error) {
          console.error("DEBUG: gym_leaderboard view error (500 or column mismatch):", error);
          viewData = []; // Ensure it's an empty array on error
        } else {
          viewData = data || [];
        }
      } catch (err) {
        console.error("DEBUG: Unexpected error fetching gym_leaderboard:", err);
        viewData = [];
      }

      // Step 2: Fetch gym_settings for gyms listed in the leaderboard view (join)
      console.log('DEBUG: Attempting to fetch gym_settings for leaderboard gyms...');
      let gymsData: any[] = [];
      try {
        const gymIds = Array.from(new Set((viewData || []).map((v: any) => v.gym_id).filter(Boolean)));
        if (gymIds.length > 0) {
          const { data, error } = await supabase
            .from('gym_settings')
            .select('id, gym_name, city, latitude, longitude, gym_owner_id, logo_url, owner_email, contact_number')
            .in('id', gymIds as any[]);

          if (error) {
            console.error('DEBUG: gym_settings fetch error (by ids):', error);
            gymsData = [];
          } else {
            gymsData = data || [];
          }
        } else {
          // fallback to full fetch
          const { data, error } = await supabase
            .from('gym_settings')
            .select('id, gym_name, city, latitude, longitude, gym_owner_id, logo_url, owner_email, contact_number');
          if (error) {
            console.error('DEBUG: gym_settings fetch error (all):', error);
            gymsData = [];
          } else {
            gymsData = data || [];
          }
        }
      } catch (err) {
        console.error('DEBUG: Unexpected error fetching gym_settings:', err);
        gymsData = [];
      }

      // Step 3: Fetch calorie sums from workout_logs for all gyms (TODAY'S DATA)
      // This ensures leaderboard matches dashboard's real-time burn
      let calorieMap: Record<string, number> = {};
      try {
        console.log('DEBUG: Fetching today\'s logs for leaderboard accuracy...');
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        
        const { data: logsData, error: logsError } = await supabase
          .from("workout_logs")
          .select("gym_id, calories_burned")
          .gte("created_at", startOfDay.toISOString());

        if (logsError) {
          console.error("DEBUG: workout_logs fetch error:", logsError);
        }

        (logsData || []).forEach(log => {
          if (log.gym_id) {
            calorieMap[log.gym_id] = (calorieMap[log.gym_id] || 0) + (Number(log.calories_burned) || 0);
          }
        });
      } catch (err) {
        console.error("DEBUG: Unexpected error in workout_logs fetch:", err);
      }

      // Step 4: Build normalized entries
      // Build a map of gym_settings by id for quick lookup
      const gymSettingsMap: Record<string, any> = {};
      (gymsData || []).forEach((g: any) => { if (g && g.id) gymSettingsMap[String(g.id)] = g; });

      const normalized: LeaderboardEntry[] = (viewData && viewData.length > 0 ? viewData : gymsData).map((row: any) => {
        const gymId = row.gym_id || row.id;
        const gym = gymSettingsMap[String(gymId)] || row;
        const todayBurn = calorieMap[gymId] || 0;
        const finalPoints = Math.max(Number(row?.vibe_points || 0), todayBurn);

        const lat = typeof gym.latitude !== 'undefined' ? Number(gym.latitude) : null;
        const lng = typeof gym.longitude !== 'undefined' ? Number(gym.longitude) : null;

        return {
          gym_id: gymId ? String(gymId) : null,
          gym_name: (gym.gym_name || gym.name || "Unknown Gym").trim(),
          city: (gym.city || "ALIGARH").trim(),
          latitude: Number.isFinite(lat) ? lat : null,
          longitude: Number.isFinite(lng) ? lng : null,
          gym_owner_id: gym.gym_owner_id || null,
          email: gym.owner_email ?? null,
          mobile_number: gym.contact_number ?? null,
          // append logoVersion cache-buster so updates propagate immediately
          logo_url: (gym.logo_url ? `${gym.logo_url}${gym.logo_url.includes('?') ? '&' : '?'}v=${logoVersion}` : ""),
          gym_photos: [],
          total_score: finalPoints,
          vibe_points: finalPoints,
          rank: 0,
          is_active: activeGymsRef.current.has(String(gymId))
        };
      })
      // Case-insensitive city filter with ALIGARH default
      .filter(entry => {
        if (!entry.gym_id) return false; // Must have an ID
        const entryCity = entry.city.toUpperCase();
        const targetCity = city.toUpperCase();
        return entryCity === targetCity || (targetCity === "ALIGARH" && (entryCity === "" || entryCity === "ALIGARH"));
      })
      .sort((a, b) => b.vibe_points - a.vibe_points)
      .map((entry, index) => ({
        ...entry,
        rank: index + 1
      }));

      console.log('DEBUG: Leaderboard Synced:', normalized.length, 'gyms found');
      setLeaderboard(normalized);
    } catch (error) {
      console.error("DEBUG: Unexpected error in fetchLeaderboard:", error);
      toast.error("Failed to load leaderboard data");
    } finally {
      setIsLoading(false);
    }
  }, [city]);

  const activateGymPulse = useCallback((gymId: string) => {
    const gymKey = String(gymId);

    activeGymsRef.current.add(gymKey);
    setPulseVersion((current) => current + 1);

    const existingTimer = activeGymTimersRef.current.get(gymKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      activeGymsRef.current.delete(gymKey);
      activeGymTimersRef.current.delete(gymKey);
      setPulseVersion((current) => current + 1);
    }, 8000);

    activeGymTimersRef.current.set(gymKey, timer);
  }, []);

  // Debounced refresh to avoid too many queries
  const refreshLeaderboard = useCallback(() => {
    // Clear any pending refresh
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    // Debounce by 500ms to batch multiple changes
    refreshTimeoutRef.current = setTimeout(() => {
      void fetchLeaderboard();
    }, 500);
  }, [fetchLeaderboard]);

  // Initial fetch
  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!enableRealtime) return;

    console.log(`Setting up robust realtime for city: ${city}`);
    const channelId = `leaderboard-${city.toLowerCase()}-${Math.random().toString(36).substring(7)}`;
    
    const channel = supabase
      .channel(channelId)
      // Listen for any changes in workout_logs to update scores instantly
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workout_logs" },
        (payload) => {
          console.log("Real-time workout update received!", payload);
          const gymId = payload?.new && typeof payload.new === "object" ? (payload.new as { gym_id?: string }).gym_id : undefined;
          if (gymId) {
            activateGymPulse(gymId);
          }
          refreshLeaderboard();
        }
      )
      // Also listen for gym settings changes (name, logo, etc.)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gym_settings" },
        (payload) => {
          console.log("Gym settings updated, refreshing leaderboard...", payload);
          // bump version to bust image cache and force fresh image fetch
          try { setLogoVersion(v => v + 1); } catch (e) { /* ignore in SSR */ }
          refreshLeaderboard();
        }
      )
      .subscribe((status) => {
        console.log(`Leaderboard subscription status: ${status}`);
        setIsRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      console.log("Cleaning up leaderboard realtime...");
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      activeGymTimersRef.current.forEach((timer) => clearTimeout(timer));
      activeGymTimersRef.current.clear();
      activeGymsRef.current.clear();
    };
  }, [activateGymPulse, city, enableRealtime, refreshLeaderboard]);

  // Sync active status whenever pulseVersion changes
  useEffect(() => {
    setLeaderboard(prev => prev.map(entry => ({
      ...entry,
      is_active: activeGymsRef.current.has(String(entry.gym_id))
    })));
  }, [pulseVersion]);

  return {
    leaderboard,
    isLoading,
    isRealtimeConnected,
    refresh: fetchLeaderboard, // Manual refresh if needed
  };
}
