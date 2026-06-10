import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/supabase";

export type MemberLeaderboardEntry = {
  /** auth user id — also the members/profiles primary key in this app */
  id: string;
  rank: number;
  name: string;
  avatar_url: string | null;
  membership_plan: string | null;
  /** total calories burned (the "calorie points") */
  points: number;
  /** flips briefly when this member logs a workout, drives the pulse animation */
  is_active: boolean;
  /** the currently authenticated member */
  is_current_user: boolean;
};

type MemberRow = {
  id: string;
  member_name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  membership_plan?: string | null;
};

type ProfileRow = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  membership_plan?: string | null;
};

type WorkoutLogRow = {
  user_id?: string | null;
  member_id?: string | null;
  calories_burned?: number | string | null;
};

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Ranks the members of a single gym by their total burned calories ("calorie
 * points"), scoped strictly to `gymId`, and keeps the ranking live by
 * subscribing to that gym's workout_logs.
 *
 * @param gymId         the gym whose members should be ranked
 * @param currentUserId the signed-in member (flagged so the UI can highlight them)
 */
export function useGymMemberLeaderboard(gymId?: string | null, currentUserId?: string | null) {
  const [leaderboard, setLeaderboard] = useState<MemberLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeMembersRef = useRef<Set<string>>(new Set());
  const activeTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const [pulseVersion, setPulseVersion] = useState(0);

  const fetchLeaderboard = useCallback(async () => {
    if (!gymId) {
      setLeaderboard([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      // 1. Roster — every member that belongs to THIS gym. We read both
      //    `members` (owner-managed roster) and `profiles` (self-service signups)
      //    and merge them so nobody is missed and we get the best avatar/name.
      const [membersRes, profilesRes, logsRes] = await Promise.all([
        supabase
          .from("members")
          .select("id, member_name, full_name, avatar_url, membership_plan")
          .eq("gym_id", gymId),
        supabase
          .from("profiles")
          .select("id, full_name, avatar_url, membership_plan")
          .eq("gym_id", gymId),
        supabase
          .from("workout_logs")
          .select("user_id, member_id, calories_burned")
          .eq("gym_id", gymId),
      ]);

      const members = (membersRes.data as MemberRow[] | null) ?? [];
      const profiles = (profilesRes.data as ProfileRow[] | null) ?? [];
      const logs = (logsRes.data as WorkoutLogRow[] | null) ?? [];

      // 2. Sum calories per member. Logs are keyed by user_id (current) or
      //    member_id (legacy) — collapse both onto one identity.
      const pointsById = new Map<string, number>();
      for (const log of logs) {
        const id = (log.user_id || log.member_id) as string | undefined;
        if (!id) continue;
        pointsById.set(id, (pointsById.get(id) || 0) + toNumber(log.calories_burned));
      }

      // 3. Merge roster sources keyed by id.
      const byId = new Map<string, MemberLeaderboardEntry>();
      const upsert = (id: string, patch: Partial<MemberLeaderboardEntry>) => {
        const existing = byId.get(id);
        byId.set(id, {
          id,
          rank: 0,
          name: existing?.name || "Member",
          avatar_url: existing?.avatar_url ?? null,
          membership_plan: existing?.membership_plan ?? null,
          points: 0,
          is_active: activeMembersRef.current.has(id),
          is_current_user: id === currentUserId,
          ...existing,
          ...patch,
        });
      };

      for (const m of members) {
        upsert(m.id, {
          name: (m.member_name || m.full_name || "Member").trim(),
          avatar_url: m.avatar_url ?? null,
          membership_plan: m.membership_plan ?? null,
        });
      }
      for (const p of profiles) {
        const existing = byId.get(p.id);
        upsert(p.id, {
          name:
            existing?.name && existing.name !== "Member"
              ? existing.name
              : (p.full_name || "Member").trim(),
          avatar_url: existing?.avatar_url || p.avatar_url || null,
          membership_plan: existing?.membership_plan || p.membership_plan || null,
        });
      }
      // Members who have logs but somehow aren't in either roster table.
      for (const id of pointsById.keys()) {
        if (!byId.has(id)) upsert(id, {});
      }

      // 4. Apply points, sort by points desc, assign ranks.
      const ranked = Array.from(byId.values())
        .map((entry) => ({
          ...entry,
          points: pointsById.get(entry.id) || 0,
          is_current_user: entry.id === currentUserId,
          is_active: activeMembersRef.current.has(entry.id),
        }))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      setLeaderboard(ranked);
    } catch (error) {
      console.error("Member leaderboard fetch failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [gymId, currentUserId]);

  // Debounced refresh so a burst of inserts triggers a single refetch.
  const refresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => void fetchLeaderboard(), 400);
  }, [fetchLeaderboard]);

  const pulseMember = useCallback((id: string) => {
    activeMembersRef.current.add(id);
    setPulseVersion((v) => v + 1);

    const existing = activeTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      activeMembersRef.current.delete(id);
      activeTimersRef.current.delete(id);
      setPulseVersion((v) => v + 1);
    }, 6000);
    activeTimersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Realtime: only this gym's workout logs move this leaderboard.
  useEffect(() => {
    if (!gymId) return;

    const channel = supabase
      .channel(`gym-member-leaderboard-${gymId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workout_logs", filter: `gym_id=eq.${gymId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as WorkoutLogRow | undefined;
          const id = row?.user_id || row?.member_id;
          if (id) pulseMember(String(id));
          refresh();
        },
      )
      // New signups / roster edits within the gym.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "members", filter: `gym_id=eq.${gymId}` },
        refresh,
      )
      .subscribe((status) => setIsRealtimeConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      activeTimersRef.current.forEach((t) => clearTimeout(t));
      activeTimersRef.current.clear();
      activeMembersRef.current.clear();
    };
  }, [gymId, pulseMember, refresh]);

  // Reflect pulse state into the rendered list without a network refetch.
  useEffect(() => {
    setLeaderboard((prev) =>
      prev.map((entry) => ({
        ...entry,
        is_active: activeMembersRef.current.has(entry.id),
      })),
    );
  }, [pulseVersion]);

  return { leaderboard, isLoading, isRealtimeConnected, refresh: fetchLeaderboard };
}
