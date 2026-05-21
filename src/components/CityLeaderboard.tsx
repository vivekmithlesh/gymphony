import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { Loader2, AlertTriangle, Trophy, Dumbbell, MapPin, Mail, Phone, Flame } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// --- CSS for Pulsing Waves ---
const pulseStyles = `
  @keyframes vibeWave {
    0% { transform: scale(0.5); opacity: 1; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  .vibe-pulse-container { position: relative; display: flex; align-items: center; justify-content: center; }
  .vibe-wave { position: absolute; border-radius: 50%; background: rgba(147, 51, 234, 0.25); animation: vibeWave 2s infinite ease-out; pointer-events: none; }
  .vibe-wave-2 { animation-delay: 0.6s; }
  .vibe-wave-3 { animation-delay: 1.2s; }
  .marker-core { position: relative; background: #9333ea; color: white; border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.3); z-index: 5; }
  .google-maps-popup .leaflet-popup-content-wrapper { border-radius: 16px; padding: 0; overflow: hidden; }
  .google-maps-popup .leaflet-popup-content { margin: 8px; width: auto !important; }
`;

export interface LeaderboardEntry {
  gym_id: string;
  gym_name: string;
  vibe_points: number;
  logo_url?: string | null;
  avatar_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  email?: string | null;
  mobile_number?: string | null;
}

// --- Internal Map Component ---
const LeaderboardMap = ({ entries }: { entries: LeaderboardEntry[] }) => {
  const validGyms = entries.filter((gym) => gym.latitude && gym.longitude);
  const defaultCenter: [number, number] = [27.8974, 78.0880];

  const createPulsingIcon = (vibePoints: number) => {
    const baseSize = 32;
    const waveRadius = Math.min(60, 30 + (vibePoints / 100)); 

    return L.divIcon({
      className: "custom-vibe-icon",
      html: `
        <div class="vibe-pulse-container" style="width: ${baseSize}px; height: ${baseSize}px;">
          <div class="vibe-wave" style="width: ${waveRadius}px; height: ${waveRadius}px;"></div>
          <div class="vibe-wave vibe-wave-2" style="width: ${waveRadius}px; height: ${waveRadius}px;"></div>
          <div class="vibe-wave vibe-wave-3" style="width: ${waveRadius}px; height: ${waveRadius}px;"></div>
          <div class="marker-core" style="width: ${baseSize}px; height: ${baseSize}px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18.5 5.5 3 3"/><path d="m2.5 15.5 3 3"/><path d="m3.5 10.5 7-7"/><path d="m13.5 20.5 7-7"/></svg>
          </div>
        </div>
      `,
      iconSize: [baseSize, baseSize],
      iconAnchor: [baseSize / 2, baseSize / 2],
    });
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-100 shadow-inner">
      <style>{pulseStyles}</style>
      <MapContainer
        center={validGyms.length > 0 ? [validGyms[0].latitude!, validGyms[0].longitude!] : defaultCenter}
        zoom={13}
        className="h-[450px] w-full z-0"
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        {validGyms.map((gym) => (
          <Marker
            key={gym.gym_id}
            position={[gym.latitude!, gym.longitude!]}
            icon={createPulsingIcon(gym.vibe_points || 0)}
          >
            <Popup className="google-maps-popup">
              <div className="w-64 p-1 font-sans text-slate-800 space-y-3">
                <div className="flex items-start justify-between border-b border-slate-100 pb-2">
                  <div className="min-w-0">
                    <h3 className="font-black text-base text-slate-900 truncate flex items-center gap-1">
                      <Dumbbell className="h-4 w-4 text-purple-600 flex-shrink-0" /> {gym.gym_name}
                    </h3>
                  </div>
                  <div className="bg-purple-50 px-2 py-1 rounded-lg border border-purple-100 text-right flex-shrink-0 flex items-center gap-0.5">
                    <Flame className="h-3.5 w-3.5 text-orange-500 fill-orange-500 animate-pulse" />
                    <span className="text-xs font-black text-purple-700">{gym.vibe_points || 0}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-600 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
                    <Mail className="h-3.5 w-3.5 text-purple-500" />
                    <span className="truncate">{gym.email || "No email available"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
                    <Phone className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{gym.mobile_number || "No contact info"}</span>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-2.5 rounded-xl text-center space-y-0.5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-purple-200">Estimated Live Metric</p>
                  <p className="text-sm font-black flex items-center justify-center gap-1">
                    {((gym.vibe_points || 0) * 1.4).toFixed(0)} kcal <span className="text-xs font-normal text-purple-200">/ hr burned</span>
                  </p>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

// --- Main Component ---
export const CityLeaderboard = () => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Maine email aur mobile_number bhi add kar diya hai popup ke liye
        const { data, error: dbError } = await supabase
          .from("gym_profiles")
          .select("gym_id:id, gym_name, vibe_points, logo_url, avatar_url, latitude, longitude, email, mobile_number")
          .order("vibe_points", { ascending: false })
          .limit(50);

        if (dbError) throw dbError;
        setLeaderboard(data || []);
      } catch (err: any) {
        console.error("DEBUG LEADERBOARD FETCH ERROR:", err);
        setError("Failed to load leaderboard data.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-rose-50 rounded-2xl border border-rose-100 max-w-4xl mx-auto my-6">
        <AlertTriangle className="h-12 w-12 text-rose-500" />
        <p className="mt-4 font-bold text-rose-700">Something went wrong</p>
      </div>
    );
  }

  const topThree = leaderboard.slice(0, 3);
  const remainingGyms = leaderboard.slice(3);

  const podiumOrder = [
    topThree[1] || null, 
    topThree[0] || null, 
    topThree[2] || null, 
  ];

  const fallbackImage = "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=150&auto=format&fit=crop&q=60";

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto w-full space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight uppercase flex items-center justify-center gap-2">
          <Trophy className="h-8 w-8 text-amber-500" /> City Leaderboard
        </h1>
      </div>

      {/* PODIUM */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-3 gap-2 md:gap-4 items-end max-w-2xl mx-auto pt-8 pb-4 px-2 min-h-[280px]">
          {podiumOrder[0] && (
            <div className="flex flex-col items-center space-y-3">
              <div className="relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-300 text-slate-800 text-xs font-black h-5 w-5 rounded-full flex items-center justify-center shadow border border-white z-10">2</div>
                <img src={podiumOrder[0].logo_url || podiumOrder[0].avatar_url || fallbackImage} alt={podiumOrder[0].gym_name} className="h-14 w-14 md:h-20 md:w-20 rounded-full object-cover border-4 border-slate-300 shadow-md" onError={(e) => { e.currentTarget.src = fallbackImage; }} />
              </div>
              <div className="text-center w-full px-1">
                <p className="text-xs md:text-sm font-black text-slate-800 truncate">{podiumOrder[0].gym_name}</p>
                <p className="text-[10px] md:text-xs font-black text-purple-600 mt-0.5">{podiumOrder[0].vibe_points?.toLocaleString() || 0} pts</p>
              </div>
              <div className="w-full bg-gradient-to-t from-slate-200 to-slate-100 h-24 md:h-32 rounded-t-xl shadow-inner border-t border-slate-300 flex items-center justify-center">
                <span className="text-2xl md:text-3xl font-black text-slate-400">II</span>
              </div>
            </div>
          )}

          {podiumOrder[1] && (
            <div className="flex flex-col items-center space-y-3 scale-105 md:scale-110 z-10">
              <div className="relative">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 text-xs font-black h-6 w-6 rounded-full flex items-center justify-center shadow border-2 border-white animate-bounce z-10">1</div>
                <img src={podiumOrder[1].logo_url || podiumOrder[1].avatar_url || fallbackImage} alt={podiumOrder[1].gym_name} className="h-18 w-18 md:h-24 md:w-24 rounded-full object-cover border-4 border-amber-400 shadow-xl" onError={(e) => { e.currentTarget.src = fallbackImage; }} />
              </div>
              <div className="text-center w-full px-1">
                <p className="text-xs md:text-sm font-black text-slate-900 truncate">{podiumOrder[1].gym_name}</p>
                <p className="text-[10px] md:text-xs font-black text-purple-600 mt-0.5">{podiumOrder[1].vibe_points?.toLocaleString() || 0} pts</p>
              </div>
              <div className="w-full bg-gradient-to-t from-amber-500 to-amber-400 h-32 md:h-40 rounded-t-xl shadow-lg border-t border-amber-300 flex items-center justify-center">
                <span className="text-3xl md:text-4xl font-black text-amber-700">I</span>
              </div>
            </div>
          )}

          {podiumOrder[2] && (
            <div className="flex flex-col items-center space-y-3">
              <div className="relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-700 text-white text-xs font-black h-5 w-5 rounded-full flex items-center justify-center shadow border border-white z-10">3</div>
                <img src={podiumOrder[2].logo_url || podiumOrder[2].avatar_url || fallbackImage} alt={podiumOrder[2].gym_name} className="h-14 w-14 md:h-20 md:w-20 rounded-full object-cover border-4 border-amber-700 shadow-md" onError={(e) => { e.currentTarget.src = fallbackImage; }} />
              </div>
              <div className="text-center w-full px-1">
                <p className="text-xs md:text-sm font-black text-slate-800 truncate">{podiumOrder[2].gym_name}</p>
                <p className="text-[10px] md:text-xs font-black text-purple-600 mt-0.5">{podiumOrder[2].vibe_points?.toLocaleString() || 0} pts</p>
              </div>
              <div className="w-full bg-gradient-to-t from-amber-800 to-amber-700 h-20 md:h-26 rounded-t-xl shadow-inner border-t border-amber-600 flex items-center justify-center">
                <span className="text-2xl md:text-3xl font-black text-amber-900/50">III</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MAP SECTION IN THE SAME FILE */}
      <div className="bg-white p-2 rounded-3xl border border-slate-100 shadow-sm mt-8">
        <LeaderboardMap entries={leaderboard} />
      </div>

      {/* FULL RANKINGS */}
      {remainingGyms.length > 0 && (
        <div className="space-y-3 bg-slate-50/50 p-4 rounded-3xl border border-slate-100">
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {remainingGyms.map((gym, index) => (
              <div key={gym.gym_id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow transition-all group">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-sm font-black text-slate-400 w-6 text-center">{index + 4}</span>
                  <div className="h-10 w-10 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 flex-shrink-0 flex items-center justify-center">
                    {gym.logo_url || gym.avatar_url ? (
                      <img src={gym.logo_url || gym.avatar_url || fallbackImage} alt={gym.gym_name} className="h-full w-full object-cover" onError={(e) => { e.currentTarget.src = fallbackImage; }} />
                    ) : (
                      <Dumbbell className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                  <p className="text-sm md:text-base font-bold text-slate-800 truncate pr-2">{gym.gym_name}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base md:text-lg font-black text-purple-600">{gym.vibe_points?.toLocaleString() || 0}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CityLeaderboard;