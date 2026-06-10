import { useMemo } from "react";
import { motion } from "framer-motion";
import { Crown, Flame, Loader2, Medal, Trophy, User as UserIcon } from "lucide-react";
import {
  useGymMemberLeaderboard,
  type MemberLeaderboardEntry,
} from "@/hooks/useGymMemberLeaderboard";

interface GymMemberLeaderboardProps {
  gymId?: string | null;
  currentUserId?: string | null;
  gymName?: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Concentric circle visual — radius / rings / glow scale with the member's  */
/*  share of the gym's top score. Higher points => larger, brighter, more     */
/*  rings around the avatar.                                                   */
/* -------------------------------------------------------------------------- */
const ConcentricAvatar = ({
  entry,
  intensity,
}: {
  entry: MemberLeaderboardEntry;
  /** 0..1 — this member's points relative to the gym leader */
  intensity: number;
}) => {
  const clamped = Math.max(0, Math.min(1, intensity));
  // Container scales subtly; rings expand outward with intensity.
  const size = 64; // avatar core box (px)
  const ringCount = 1 + Math.round(clamped * 3); // 1..4 rings
  const maxExtra = 26; // px the outer ring extends past the avatar at full power

  const rings = Array.from({ length: ringCount }, (_, i) => {
    const step = (i + 1) / ringCount;
    const extra = maxExtra * clamped * step;
    return {
      inset: -extra,
      opacity: 0.08 + (1 - step) * 0.22 * (0.4 + clamped),
      delay: i * 0.35,
    };
  });

  const glow = 6 + clamped * 26; // px blur on the avatar's purple aura

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Expanding concentric rings */}
      {rings.map((ring, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border"
          style={{
            top: ring.inset,
            bottom: ring.inset,
            left: ring.inset,
            right: ring.inset,
            borderColor: `rgba(147, 51, 234, ${ring.opacity})`,
          }}
          animate={
            entry.is_active
              ? { scale: [1, 1.12, 1], opacity: [ring.opacity, ring.opacity * 1.8, ring.opacity] }
              : { scale: 1 }
          }
          transition={{
            duration: 1.8,
            repeat: entry.is_active ? Infinity : 0,
            delay: ring.delay,
            ease: "easeOut",
          }}
        />
      ))}

      {/* Glowing avatar core */}
      <div
        className="relative h-14 w-14 overflow-hidden rounded-full border-2 border-white bg-linear-to-br from-purple-500 to-indigo-600"
        style={{ boxShadow: `0 0 ${glow}px rgba(147,51,234,${0.35 + clamped * 0.5})` }}
      >
        {entry.avatar_url ? (
          <img
            src={entry.avatar_url}
            alt={entry.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-base font-black text-white">
            {entry.name?.trim()?.charAt(0)?.toUpperCase() || <UserIcon className="h-5 w-5" />}
          </div>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*  Rank badge — gold / silver / bronze for the podium, plain chip otherwise. */
/* -------------------------------------------------------------------------- */
const RankBadge = ({ rank }: { rank: number }) => {
  if (rank === 1)
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-amber-300 to-amber-500 text-amber-950 shadow-md">
        <Crown className="h-5 w-5" />
      </div>
    );
  if (rank === 2)
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-slate-200 to-slate-400 text-slate-700 shadow">
        <Medal className="h-5 w-5" />
      </div>
    );
  if (rank === 3)
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-orange-300 to-amber-700 text-white shadow">
        <Medal className="h-5 w-5" />
      </div>
    );
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-500">
      {rank}
    </div>
  );
};

const MemberCard = ({
  entry,
  topScore,
  index,
}: {
  entry: MemberLeaderboardEntry;
  topScore: number;
  index: number;
}) => {
  const intensity = topScore > 0 ? entry.points / topScore : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: Math.min(index * 0.04, 0.4),
        type: "spring",
        stiffness: 260,
        damping: 24,
      }}
      className={[
        "relative flex items-center gap-4 rounded-3xl border p-3 pr-5 shadow-sm transition-all sm:gap-5 sm:p-4",
        entry.is_current_user
          ? "border-purple-300 bg-linear-to-r from-purple-50 to-indigo-50 ring-2 ring-purple-200"
          : "border-slate-100 bg-white hover:border-purple-100 hover:shadow-md",
      ].join(" ")}
    >
      <RankBadge rank={entry.rank} />

      <ConcentricAvatar entry={entry} intensity={intensity} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-black text-slate-900 sm:text-base">{entry.name}</p>
          {entry.is_current_user && (
            <span className="shrink-0 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              You
            </span>
          )}
        </div>
        <p className="truncate text-xs font-medium text-slate-400">
          {entry.membership_plan || "Member"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end">
        <div className="flex items-center gap-1">
          <Flame
            className={[
              "h-4 w-4 text-orange-500",
              entry.is_active ? "animate-pulse fill-orange-500" : "fill-orange-200",
            ].join(" ")}
          />
          <span className="text-lg font-black text-purple-700 tabular-nums sm:text-xl">
            {entry.points.toLocaleString()}
          </span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          cal points
        </span>
      </div>
    </motion.div>
  );
};

export const GymMemberLeaderboard = ({
  gymId,
  currentUserId,
  gymName,
}: GymMemberLeaderboardProps) => {
  const { leaderboard, isLoading } = useGymMemberLeaderboard(gymId, currentUserId);

  const topScore = useMemo(
    () => leaderboard.reduce((max, e) => Math.max(max, e.points), 0),
    [leaderboard],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-100 flex-col items-center justify-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-purple-600" />
        <p className="text-sm font-medium text-slate-400">Loading your gym leaderboard…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-2 sm:p-4">
      {/* Header */}
      <div className="space-y-1 text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-black uppercase tracking-tight text-slate-900 sm:text-3xl">
          <Trophy className="h-7 w-7 text-amber-500" /> Gym Leaderboard
        </h1>
        <p className="text-sm font-medium text-slate-400">
          {gymName ? (
            <>
              Ranking members of <span className="font-bold text-purple-600">{gymName}</span> by
              calorie points
            </>
          ) : (
            "Ranking your gym's members by calorie points"
          )}
        </p>
      </div>

      {leaderboard.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
          <Flame className="h-10 w-10 text-slate-300" />
          <p className="font-bold text-slate-600">No calorie points yet</p>
          <p className="max-w-xs text-sm text-slate-400">
            Log a workout to light up the leaderboard and start the competition!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {leaderboard.map((entry, index) => (
            <MemberCard key={entry.id} entry={entry} topScore={topScore} index={index} />
          ))}
        </div>
      )}
    </div>
  );
};

export default GymMemberLeaderboard;
