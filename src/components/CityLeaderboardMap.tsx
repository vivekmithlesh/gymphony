import { Fragment, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { createDefaultMarkerIcon } from "@/lib/leafletDefaultIcon";
import { ArrowRight, Dumbbell, Flame, Trophy } from "lucide-react";
import type { GymLeaderboardEntry } from "@/hooks/useCityGymLeaderboard";

// Explicit stock blue pin (client-only — this module is React.lazy'd, so it
// never evaluates during SSR). Passed to every <Marker> so the icon can't fail
// to resolve.
const defaultIcon = createDefaultMarkerIcon(L) as L.Icon;

/**
 * Leaflet map for the city gym leaderboard. Lives in its own module so the
 * `leaflet` / `react-leaflet` imports are only evaluated on the client (the
 * parent loads it via React.lazy after mount) — keeping SSR safe.
 */

const markerStyles = `
  /* --- Calorie "water ripple": RED outline-only rings expanding + fading from
     the pin (like a stone hitting water). Transparent inside — border only.
     Ring max-size scales with the gym's calories (set inline). */
  @keyframes gpRipple {
    0%   { transform: translate(-50%, -50%) scale(0.2); opacity: 0.9; }
    70%  { opacity: 0.35; }
    100% { transform: translate(-50%, -50%) scale(1);   opacity: 0;   }
  }
  .gp-pulse-wrap { position: relative; }
  .gp-pulse {
    position: absolute; left: 50%; top: 50%; border-radius: 9999px;
    /* Soft RED gradient ring — transparent centre, red fading out at the edges
       (a gradient pulse, not a solid disc or a hard outline). Size is set inline
       so the ripple scales with the gym's calories. */
    background: radial-gradient(circle,
      rgba(239, 68, 68, 0) 48%,
      rgba(239, 68, 68, 0.55) 70%,
      rgba(239, 68, 68, 0.12) 86%,
      rgba(239, 68, 68, 0) 100%);
    pointer-events: none; animation: gpRipple 2.1s ease-out infinite;
  }
  .gp-pulse-2 { animation-delay: 0.7s; }
  .gp-pulse-3 { animation-delay: 1.4s; }

  /* --- Fullscreen toggle button. */
  .gp-fs-btn {
    display: flex; align-items: center; justify-content: center; width: 34px; height: 34px;
    cursor: pointer; border: none; border-radius: 10px; background: #fff; color: #334155;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18); transition: background 0.15s, color 0.15s;
  }
  .gp-fs-btn:hover { background: #7c3aed; color: #fff; }
  .gp-fs-btn svg { width: 18px; height: 18px; }

  /* --- Popup polish. */
  .gp-popup .leaflet-popup-content-wrapper { border-radius: 18px; padding: 0; overflow: hidden; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25); }
  .gp-popup .leaflet-popup-content { margin: 0; width: auto !important; }
  .gp-popup .leaflet-popup-tip { background: #fff; }
`;

const ALIGARH_CENTER: [number, number] = [27.8974, 78.088];

// Below this zoom the gyms are hidden so the markers don't scatter across the
// whole map when zoomed out (revealed once you zoom into the city).
const MARKER_ZOOM = 11;

// A pulse-only divIcon (no pin) drawn behind the blue marker: a soft RED
// water-ripple centred on the marker point (the pin's base/bottom). The ring
// radius scales with the gym's calories vs the city leader (capped), so a busier
// gym ripples wider.
const buildPulseIcon = (entry: GymLeaderboardEntry, topScore: number) => {
  const base = entry.rank === 1 ? 34 : 28;
  const intensity = topScore > 0 ? entry.vibe_points / topScore : 0;
  const pulse = Math.round(base + 12 + Math.min(60, entry.vibe_points / 25) + intensity * 14);
  const ring = (cls: string) =>
    `<span class="${cls}" style="width:${pulse}px;height:${pulse}px;"></span>`;

  return L.divIcon({
    className: "gp-pulse-icon",
    html: `<div class="gp-pulse-wrap" style="width:${base}px;height:${base}px;">${ring("gp-pulse")}${ring("gp-pulse gp-pulse-2")}${ring("gp-pulse gp-pulse-3")}</div>`,
    iconSize: [base, base],
    iconAnchor: [base / 2, base / 2],
  });
};

// Tracks live map zoom so the parent can hide markers when zoomed out.
const ZoomWatcher = ({ onZoom }: { onZoom: (z: number) => void }) => {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => onZoom(map.getZoom()), [map, onZoom]);
  return null;
};

const EXPAND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
const COLLAPSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;

/**
 * A native-fullscreen toggle, added as a real Leaflet control so it travels
 * into the fullscreen surface with the map. invalidateSize() after the
 * transition keeps tiles crisp at the new dimensions.
 */
const FullscreenControl = () => {
  const map = useMap();

  useEffect(() => {
    const FsControl = L.Control.extend({
      options: { position: "topright" as L.ControlPosition },
      onAdd() {
        const btn = L.DomUtil.create("button", "gp-fs-btn") as HTMLButtonElement;
        btn.type = "button";
        btn.title = "Toggle fullscreen";
        btn.setAttribute("aria-label", "Toggle fullscreen");
        btn.innerHTML = EXPAND_ICON;
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.disableScrollPropagation(btn);
        L.DomEvent.on(btn, "click", (e) => {
          L.DomEvent.stop(e);
          const el = map.getContainer();
          if (!document.fullscreenElement) {
            void el.requestFullscreen?.().catch(() => {});
          } else {
            void document.exitFullscreen?.();
          }
        });
        return btn;
      },
    });

    const control = new FsControl();
    control.addTo(map);

    const onFsChange = () => {
      const el = map.getContainer();
      const btn = el.querySelector<HTMLButtonElement>(".gp-fs-btn");
      const isFs = document.fullscreenElement === el;
      if (btn) btn.innerHTML = isFs ? COLLAPSE_ICON : EXPAND_ICON;
      // Let the browser finish the resize, then refit the tile grid.
      window.setTimeout(() => map.invalidateSize(), 150);
    };
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      control.remove();
    };
  }, [map]);

  return null;
};

const CityLeaderboardMap = ({ entries }: { entries: GymLeaderboardEntry[] }) => {
  const located = entries.filter((g) => g.latitude != null && g.longitude != null);
  const center: [number, number] = located.length
    ? [located[0].latitude as number, located[0].longitude as number]
    : ALIGARH_CENTER;
  const topScore = located.reduce((m, g) => Math.max(m, g.vibe_points), 0);

  const [zoom, setZoom] = useState(13);
  const showMarkers = zoom >= MARKER_ZOOM;

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-slate-200 shadow-inner">
      <style>{markerStyles}</style>
      <MapContainer center={center} zoom={13} scrollWheelZoom className="z-0 h-115 w-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FullscreenControl />
        <ZoomWatcher onZoom={setZoom} />
        {showMarkers &&
          located.map((gym) => (
            <Fragment key={gym.gym_id}>
              {/* Calorie "blink" ring behind the pin — always shown so the map
                  feels alive; orange when the gym is live, sized by calories. */}
              <Marker
                position={[gym.latitude as number, gym.longitude as number]}
                icon={buildPulseIcon(gym, topScore)}
                interactive={false}
                zIndexOffset={-1000}
              />
              <Marker
                position={[gym.latitude as number, gym.longitude as number]}
                icon={defaultIcon}
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
            </Fragment>
          ))}
      </MapContainer>
    </div>
  );
};

export default CityLeaderboardMap;
