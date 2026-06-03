import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowRight, Dumbbell, Flame, Trophy } from "lucide-react";
import type { GymLeaderboardEntry } from "@/hooks/useCityGymLeaderboard";

/**
 * Leaflet map for the city gym leaderboard. Lives in its own module so the
 * `leaflet` / `react-leaflet` imports are only evaluated on the client (the
 * parent loads it via React.lazy after mount) — keeping SSR safe.
 */

const markerStyles = `
  /* Pulse expands from the pin centre; only rendered while a gym is ACTIVE. */
  @keyframes gpPulse {
    0%   { transform: translate(-50%, -50%) scale(0.35); opacity: 0.5; }
    100% { transform: translate(-50%, -50%) scale(1);    opacity: 0;   }
  }
  .gp-marker { position: relative; display: flex; align-items: center; justify-content: center; }
  .gp-pulse { position: absolute; left: 50%; top: 50%; border-radius: 9999px; pointer-events: none; animation: gpPulse 1.9s ease-out infinite; }
  .gp-pulse-2 { animation-delay: 0.63s; }
  .gp-pulse-3 { animation-delay: 1.26s; }
  /* Compact, Google-style circular pin. */
  .gp-pin { position: relative; z-index: 5; display: flex; align-items: center; justify-content: center; color: #fff; border: 2.5px solid #fff; border-radius: 9999px; box-shadow: 0 3px 9px rgba(15, 23, 42, 0.4); font-weight: 800; line-height: 1; }
  .gp-pin-1 { background: linear-gradient(135deg, #fbbf24, #f97316); }  /* gold  */
  .gp-pin-2 { background: linear-gradient(135deg, #cbd5e1, #94a3b8); }  /* silver */
  .gp-pin-3 { background: linear-gradient(135deg, #fb923c, #c2410c); }  /* bronze */
  .gp-pin-n { background: linear-gradient(135deg, #a78bfa, #7c3aed); }  /* purple */
  .gp-popup .leaflet-popup-content-wrapper { border-radius: 18px; padding: 0; overflow: hidden; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25); }
  .gp-popup .leaflet-popup-content { margin: 0; width: auto !important; }
  .gp-popup .leaflet-popup-tip { background: #fff; }
`;

const ALIGARH_CENTER: [number, number] = [27.8974, 78.088];

const buildIcon = (entry: GymLeaderboardEntry, topScore: number) => {
  const isLeader = entry.rank === 1;
  const size = isLeader ? 34 : 28; // compact, like a real map marker
  const rankClass = entry.rank <= 3 ? String(entry.rank) : "n";
  const label = isLeader ? "🔥" : `#${entry.rank}`;

  // Pulse radius scales pixel-wise with this gym's calories (capped), with a
  // small boost for the city leader. Only drawn when the gym is active NOW.
  const intensity = topScore > 0 ? entry.vibe_points / topScore : 0;
  const pulse = Math.round(size + 12 + Math.min(60, entry.vibe_points / 25) + intensity * 14);
  const glow = isLeader ? "rgba(249, 115, 22, 0.32)" : "rgba(124, 58, 237, 0.28)";

  const pulseHtml = entry.is_active
    ? ["gp-pulse", "gp-pulse gp-pulse-2", "gp-pulse gp-pulse-3"]
        .map(
          (cls) =>
            `<span class="${cls}" style="width:${pulse}px;height:${pulse}px;background:${glow};"></span>`,
        )
        .join("")
    : "";

  return L.divIcon({
    className: "gp-custom-icon",
    html: `
      <div class="gp-marker" style="width:${size}px;height:${size}px;">
        ${pulseHtml}
        <div class="gp-pin gp-pin-${rankClass}" style="width:${size}px;height:${size}px;font-size:${isLeader ? 15 : 11}px;">
          ${label}
        </div>
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const CityLeaderboardMap = ({ entries }: { entries: GymLeaderboardEntry[] }) => {
  const located = entries.filter((g) => g.latitude != null && g.longitude != null);
  const center: [number, number] = located.length
    ? [located[0].latitude as number, located[0].longitude as number]
    : ALIGARH_CENTER;
  const topScore = located.reduce((m, g) => Math.max(m, g.vibe_points), 0);

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-slate-200 shadow-inner">
      <style>{markerStyles}</style>
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} className="z-0 h-115 w-full">
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        {located.map((gym) => (
          <Marker
            key={`${gym.gym_id}-${gym.is_active ? "live" : "idle"}-${gym.rank}`}
            position={[gym.latitude as number, gym.longitude as number]}
            icon={buildIcon(gym, topScore)}
          >
            <Popup className="gp-popup">
              <div className="w-72 font-sans">
                {/* Header — logo + name + rank-in-city */}
                <div className="flex items-center gap-3 bg-linear-to-r from-purple-600 to-indigo-600 px-4 py-3 text-white">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/20 ring-2 ring-white/40">
                    {gym.logo_url ? (
                      <img src={gym.logo_url} alt={gym.gym_name} className="h-full w-full object-cover" />
                    ) : (
                      <Dumbbell className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black leading-tight">{gym.gym_name}</h3>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-white/90">
                      <Trophy className="h-3 w-3" /> #{gym.rank} in {gym.city}
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5 p-4">
                  {/* Core metric — calories this month */}
                  <div className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      🔥 Calories burned this month
                    </span>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <Flame className="h-5 w-5 shrink-0 fill-orange-500 text-orange-500" />
                      <span className="text-xl font-black text-orange-600 tabular-nums">
                        {gym.vibe_points.toLocaleString()}
                      </span>
                      <span className="text-xs font-bold text-slate-400">kcal</span>
                    </div>
                  </div>

                  {/* Secondary stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-center">
                      <p className="text-base font-black text-slate-800 tabular-nums">{gym.active_members.toLocaleString()}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Active Members</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-center">
                      <p className="text-base font-black text-slate-800 tabular-nums">{gym.checkins.toLocaleString()}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Check-ins</p>
                    </div>
                  </div>

                  <a
                    href={`/gym-detail/${gym.gym_id}`}
                    className="mt-1 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-linear-to-r from-purple-600 to-indigo-600 text-sm font-bold text-white no-underline transition-opacity hover:opacity-90"
                  >
                    View Gym Profile <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default CityLeaderboardMap;
