import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  CalendarCheck2,
  Crown,
  Dumbbell,
  Flame,
  Loader2,
  MapPin,
  Medal,
  Trophy,
  Users,
  Wifi,
} from "lucide-react";
import { useCityGymLeaderboard, type GymLeaderboardEntry } from "@/hooks/useCityGymLeaderboard";
import { supabase } from "@/supabase";

// Map is client-only (Leaflet touches `window`), so load it lazily after mount.
const CityLeaderboardMap = lazy(() => import("./CityLeaderboardMap"));

const CITY = "ALIGARH";

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "GP";

/* -------------------------------------------------------------------------- */
/*  Gym avatar — shows the logo, and falls back to gradient initials instead   */
/*  of a broken-image placeholder.                                             */
/* -------------------------------------------------------------------------- */
const GymAvatar = ({
  entry,
  className,
  variant = "purple",
}: {
  entry: GymLeaderboardEntry;
  className?: string;
  variant?: "gold" | "silver" | "bronze" | "purple";
}) => {
  const [failed, setFailed] = useState(false);
  const ring =
    variant === "gold"
      ? "from-amber-300 to-orange-500"
      : variant === "silver"
        ? "from-slate-200 to-slate-400"
        : variant === "bronze"
          ? "from-orange-300 to-amber-700"
          : "from-purple-500 to-indigo-600";

  return (
    <div
      className={`overflow-hidden rounded-full bg-linear-to-br ${ring} flex items-center justify-center ${className ?? ""}`}
    >
      {entry.logo_url && !failed ? (
        <img
          src={entry.logo_url}
          alt={entry.gym_name}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="font-black text-white">{initials(entry.gym_name)}</span>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*  Stat pill                                                                  */
/* -------------------------------------------------------------------------- */
const StatPill = ({
  icon: Icon,
  children,
  tone = "default",
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  tone?: "default" | "live";
}) => (
  <div
    className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-sm ${
      tone === "live"
        ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"
        : "bg-white text-slate-700 ring-1 ring-slate-100"
    }`}
  >
    <Icon className={`h-4 w-4 ${tone === "live" ? "text-emerald-500" : "text-purple-600"}`} />
    {children}
  </div>
);

/* -------------------------------------------------------------------------- */
/*  Live "now" dot                                                             */
/* -------------------------------------------------------------------------- */
const LiveDot = () => (
  <span className="relative flex h-2 w-2">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
  </span>
);

/* -------------------------------------------------------------------------- */
/*  Champion spotlight — premium hero for the #1 gym (looks great solo too).   */
/* -------------------------------------------------------------------------- */
const ChampionCard = ({ entry, isMine, city }: { entry: GymLeaderboardEntry; isMine: boolean; city: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ type: "spring", stiffness: 180, damping: 22 }}
    className="relative overflow-hidden rounded-[2rem] bg-linear-to-br from-violet-600 via-purple-600 to-indigo-700 p-px shadow-2xl shadow-purple-500/25"
  >
    {/* soft glow blobs for depth */}
    <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-fuchsia-400/30 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-20 -left-12 h-56 w-56 rounded-full bg-indigo-400/30 blur-3xl" />

    <div className="relative rounded-[calc(2rem-1px)] bg-white/95 p-6 backdrop-blur-sm sm:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
        {/* Avatar + crown. The "live" pulse intentionally lives only on the map
            marker now — keeping the hero avatar calm and premium. */}
        <div className="relative flex shrink-0 items-center justify-center">
          <Crown className="absolute -top-8 z-20 h-9 w-9 fill-amber-400 text-amber-500 drop-shadow" />
          <div className="relative z-10">
            <GymAvatar
              entry={entry}
              variant="gold"
              className="h-28 w-28 border-4 border-white text-3xl shadow-xl sm:h-32 sm:w-32"
            />
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-linear-to-br from-amber-300 to-orange-500 px-3 py-0.5 text-xs font-black text-amber-950 shadow ring-2 ring-white">
              #1
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="mb-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-amber-400 to-orange-500 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white shadow-sm">
              <Crown className="h-3.5 w-3.5" /> City Champion
            </span>
            {entry.is_active && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-600 ring-1 ring-emerald-200">
                <LiveDot /> Live now
              </span>
            )}
            {isMine && (
              <span className="rounded-full bg-purple-600 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white">
                You
              </span>
            )}
          </div>

          <h2 className="truncate text-2xl font-black uppercase leading-tight tracking-tight text-slate-900 sm:text-3xl">
            {entry.gym_name}
          </h2>
          <p className="mt-0.5 text-xs font-bold uppercase tracking-widest text-slate-400">#1 in {city}</p>

          <div className="mt-3 flex items-baseline justify-center gap-2 sm:justify-start">
            <Flame className="h-7 w-7 shrink-0 self-center fill-orange-500 text-orange-500" />
            <span className="bg-linear-to-r from-purple-600 to-violet-500 bg-clip-text text-4xl font-black tabular-nums text-transparent sm:text-5xl">
              {entry.vibe_points.toLocaleString()}
            </span>
            <span className="text-sm font-bold text-slate-400">kcal · this month</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-700 ring-1 ring-slate-100">
              <Users className="h-4 w-4 text-purple-500" /> {entry.active_members.toLocaleString()} Active
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-700 ring-1 ring-slate-100">
              <CalendarCheck2 className="h-4 w-4 text-purple-500" /> {entry.checkins.toLocaleString()} Check-ins
            </span>
          </div>
        </div>
      </div>
    </div>
  </motion.div>
);

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */
export const CityLeaderboard = () => {
  const { leaderboard, isLoading, isRealtimeConnected } = useCityGymLeaderboard(CITY);

  // Only mount Leaflet on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The logged-in owner's own gym, so we can highlight "where they stand".
  const [myGymId, setMyGymId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const { data } = await supabase
        .from("gym_settings")
        .select("id")
        .eq("gym_owner_id", session.user.id)
        .maybeSingle();
      if (active) setMyGymId(data?.id ?? null);
    })();
    return () => { active = false; };
  }, []);

  const myRank = useMemo(
    () => leaderboard.find((g) => g.gym_id === myGymId)?.rank ?? null,
    [leaderboard, myGymId],
  );

  const leader = leaderboard[0] ?? null;
  const runnersUp = leaderboard.slice(1);
  const hasMapData = leaderboard.some((g) => g.latitude != null && g.longitude != null);

  if (isLoading) {
    return (
      <div className="flex min-h-100 flex-col items-center justify-center gap-3">
        <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
        <p className="text-sm font-medium text-slate-400">Loading the city rankings…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 p-4 md:p-8">
      {/* ---------- Header ---------- */}
      <div className="space-y-5 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 shadow-sm ring-1 ring-slate-100">
          <Trophy className="h-4 w-4 text-amber-500" /> Live {CITY} Rankings
        </div>
        <h1 className="text-4xl font-black uppercase tracking-tight text-slate-900 sm:text-6xl">
          Gym{" "}
          <span className="bg-linear-to-r from-purple-600 to-violet-500 bg-clip-text italic text-transparent">
            Phonics
          </span>
        </h1>
        <p className="mx-auto max-w-xl text-sm font-medium text-slate-500 sm:text-base">
          The ultimate vibe check. Ranking {CITY}&apos;s gyms by the sweat, burn, and energy of
          their real members.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <StatPill icon={Activity}>{leaderboard.length} Gyms Live</StatPill>
          <StatPill icon={MapPin}>{CITY}</StatPill>
          <StatPill icon={Wifi} tone="live">
            {isRealtimeConnected ? "Connected Live" : "Reconnecting…"}
          </StatPill>
          {myRank && (
            <StatPill icon={Trophy}>
              You&apos;re #{myRank} in {CITY}
            </StatPill>
          )}
        </div>
      </div>

      {/* ---------- Champion spotlight ---------- */}
      {leader ? (
        <ChampionCard entry={leader} isMine={leader.gym_id === myGymId} city={CITY} />
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 p-12 text-center">
          <Flame className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-bold text-slate-600">No gyms ranked yet in {CITY}</p>
        </div>
      )}

      {/* ---------- Interactive Map ---------- */}
      {hasMapData && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-black uppercase tracking-tight text-slate-900">
            <MapPin className="h-5 w-5 text-purple-600" /> The Arena Map
          </h2>
          <div className="rounded-3xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
            {mounted ? (
              <Suspense
                fallback={
                  <div className="flex h-115 items-center justify-center rounded-3xl bg-slate-50">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                  </div>
                }
              >
                <CityLeaderboardMap entries={leaderboard} />
              </Suspense>
            ) : (
              <div className="h-115 rounded-3xl bg-slate-50" />
            )}
          </div>
        </div>
      )}

      {/* ---------- Runners-up (rank 2+) ---------- */}
      {runnersUp.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-black uppercase tracking-tight text-slate-900">
            <Medal className="h-5 w-5 text-purple-600" /> The Chasing Pack
          </h2>
          <div className="space-y-2.5">
            {runnersUp.map((gym) => {
              const isMine = gym.gym_id === myGymId;
              const rankBadge =
                gym.rank === 2
                  ? "from-slate-300 to-slate-400 text-slate-800"
                  : gym.rank === 3
                    ? "from-orange-300 to-amber-600 text-white"
                    : "from-purple-100 to-purple-200 text-purple-700";
              const avatarVariant =
                gym.rank === 2 ? "silver" : gym.rank === 3 ? "bronze" : "purple";
              return (
                <motion.div
                  key={gym.gym_id}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex items-center justify-between gap-3 rounded-2xl border p-3 pr-5 transition-all ${
                    isMine
                      ? "border-purple-300 bg-purple-50 ring-2 ring-purple-200"
                      : "border-slate-100 bg-white shadow-sm hover:border-purple-100 hover:shadow-md"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br text-xs font-black shadow-sm ${rankBadge}`}
                    >
                      #{gym.rank}
                    </span>
                    <GymAvatar entry={gym} variant={avatarVariant} className="h-11 w-11 text-sm" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-bold text-slate-800">
                        <span className="truncate">{gym.gym_name}</span>
                        {gym.is_active && <LiveDot />}
                        {isMine && (
                          <span className="shrink-0 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                            You
                          </span>
                        )}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-slate-400">
                        <Dumbbell className="h-3 w-3" /> {gym.city}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-1">
                    <Flame className="h-4 w-4 self-center fill-orange-400 text-orange-500" />
                    <span className="text-base font-black text-purple-700 tabular-nums">
                      {gym.vibe_points.toLocaleString()}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">kcal</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CityLeaderboard;
