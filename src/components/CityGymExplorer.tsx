import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Star, LocateFixed, Maximize2, Minimize2, Dumbbell, MapPin, Users, Share2, Navigation } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { cn } from "@/lib/utils";

// Haversine formula to calculate distance between two lat/lon points in km
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

interface GymData {
  id: string;
  gym_name: string;
  latitude: number | null;
  longitude: number | null;
  city?: string;
  rating?: number;
  active_members_footfall?: 'Low' | 'Medium' | 'High';
  distance?: number;
}

const ALIGARH_CENTER: L.LatLngExpression = [27.8974, 78.0880];

const createCustomMarkerIcon = (gym: GymData) => {
  const footfallColor =
    gym.active_members_footfall === 'High' ? '#ef4444' :
    gym.active_members_footfall === 'Medium' ? '#f97316' :
    '#22c55e';

  return L.divIcon({
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-8 h-8 bg-white rounded-full border-2 border-slate-200 shadow-md"></div>
        <div style="background-color: ${footfallColor};" class="absolute w-3 h-3 rounded-full top-0 right-0 border-2 border-white"></div>
        <svg class="relative w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 20l-4.95-5.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
        </svg>
      </div>
    `,
    className: 'bg-transparent border-0',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
};

const MapController = ({ center, isMaximized }: { center: L.LatLngExpression | null, isMaximized: boolean }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, 15, { animate: true, duration: 1.5 });
    }
  }, [center, map]);

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 400);
    return () => clearTimeout(timer);
  }, [isMaximized, map]);

  return null;
};

export function CityGymExplorer({ onJoinGym }: { onJoinGym: (gymId: string) => void; }) {
  const [allGyms, setAllGyms] = useState<GymData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGym, setSelectedGym] = useState<GymData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mapCenter, setMapCenter] = useState<L.LatLngExpression | null>(ALIGARH_CENTER);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'nearMe'>('all');
  const [isLocating, setIsLocating] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const fetchGyms = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("gym_profiles")
        .select("id:gym_id, gym_name, latitude, longitude, city, rating, active_members_footfall");

      if (error) throw error;
      
      const validGyms = (data || []).filter(gym => {
        if (!gym.latitude || !gym.longitude) {
          console.warn(`Gym "${gym.gym_name}" (ID: ${gym.id}) has missing coordinates.`);
          return false;
        }
        return true;
      });

      setAllGyms(validGyms as GymData[]);
    } catch (error: any) {
      toast.error("Failed to fetch gyms.", { description: error.message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGyms();
  }, [fetchGyms]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isMaximized) {
        setIsMaximized(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMaximized]);


  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser.");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lon: longitude });
        setMapCenter([latitude, longitude]);
        setFilterMode('nearMe');
        setIsLocating(false);
        toast.success("Found gyms near you!");
      },
      (error) => {
        toast.error("Could not get your location.", { description: error.message });
        setIsLocating(false);
      }
    );
  };

  const gymsWithDistance = useMemo(() => {
    if (!userLocation) return allGyms;
    return allGyms.map(gym => ({
      ...gym,
      distance: haversineDistance(userLocation.lat, userLocation.lon, gym.latitude!, gym.longitude!),
    })).sort((a, b) => a.distance - b.distance);
  }, [allGyms, userLocation]);

  const filteredGyms = useMemo(() => {
    let gymsToFilter = filterMode === 'nearMe' ? gymsWithDistance.filter(g => g.distance! <= 2) : allGyms;
    
    const query = searchQuery.trim().toLowerCase();
    if (!query) return gymsToFilter;

    return gymsToFilter.filter((gym) =>
      gym.gym_name.toLowerCase().includes(query) ||
      (gym.city && gym.city.toLowerCase().includes(query))
    );
  }, [allGyms, gymsWithDistance, searchQuery, filterMode]);

  const handleMarkerClick = (gym: GymData) => {
    setSelectedGym(gym);
    if (gym.latitude && gym.longitude) {
      setMapCenter([gym.latitude, gym.longitude]);
    }
  };
  
  const handleCardClick = (gym: GymData) => {
    setSelectedGym(gym);
    if (gym.latitude && gym.longitude) {
      setMapCenter([gym.latitude, gym.longitude]);
    }
  };

  const handleJoinClick = async (gymId: string) => {
    setIsJoining(true);
    try {
      await onJoinGym(gymId);
    } finally {
      setIsJoining(false);
    }
  };

  // Add Google Maps style CSS for popup
  const popupStyles = `
    .gym-detail-popup .leaflet-popup-content-wrapper {
      border-radius: 16px !important;
      padding: 0 !important;
      overflow: hidden !important;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25) !important;
    }
    .gym-detail-popup .leaflet-popup-content {
      margin: 0 !important;
      width: auto !important;
    }
    .gym-detail-popup .leaflet-popup-tip-container {
      margin-top: -1px;
    }
  `;

  return (
    <div className={cn(
      "relative rounded-[3rem] border border-slate-200/60 bg-white shadow-elegant overflow-hidden w-full",
      isMaximized
        ? "fixed inset-0 z-[9999] rounded-none"
        : "h-[60vh] md:h-[75vh] min-h-[500px]"
    )}>
      <style>{popupStyles}</style>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,1fr)_2fr] h-full">
        
        {!isMaximized && (
          <div className="flex flex-col h-full border-r border-slate-200/60">
            <div className="p-4 border-b border-slate-200/80 space-y-3 shrink-0">
              <h2 className="text-lg font-bold text-slate-800 px-1">Explore Gyms</h2>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or city..."
                  className="pl-11 h-12 rounded-2xl border-slate-200 bg-slate-50 text-base"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleGeolocate} disabled={isLocating} variant="outline" className="w-full rounded-xl h-11">
                  {isLocating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-2 h-4 w-4" />}
                  Near Me
                </Button>
                <Button onClick={() => setFilterMode('all')} variant={filterMode === 'all' ? 'secondary' : 'outline'} className="w-full rounded-xl h-11">All Gyms</Button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
              ) : (
                <div className="space-y-1">
                  {filteredGyms.map((gym) => (
                    <button
                      key={gym.id}
                      onClick={() => handleCardClick(gym)}
                      className={cn(
                        'w-full text-left p-3 rounded-2xl transition-colors',
                        selectedGym?.id === gym.id ? 'bg-primary/10' : 'hover:bg-slate-50'
                      )}
                    >
                      <p className="font-bold text-slate-800">{gym.gym_name}</p>
                      <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
                        <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                        <span>{gym.rating?.toFixed(1) || 'N/A'}</span>
                        <span className="text-slate-300">•</span>
                        {filterMode === 'nearMe' && gym.distance !== undefined ? (
                          <span>{gym.distance.toFixed(2)} km away</span>
                        ) : (
                          <span>{gym.city || 'Unknown City'}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="relative h-full w-full">
          <MapContainer center={ALIGARH_CENTER} zoom={13} className="w-full h-full z-0 rounded-2xl overflow-hidden shadow-sm">
            <MapController center={mapCenter} isMaximized={isMaximized} />
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
            
            {userLocation && filterMode === 'nearMe' && (
              <Circle center={[userLocation.lat, userLocation.lon]} radius={2000} pathOptions={{ color: '#8B5CF6', fillColor: '#8B5CF6', fillOpacity: 0.1 }} />
            )}
            {filteredGyms.map((gym) => {
              if (!gym.latitude || !gym.longitude) return null;
              return (
                <Marker
                  key={gym.id}
                  position={[gym.latitude, gym.longitude]}
                  icon={createCustomMarkerIcon(gym)}
                  eventHandlers={{ click: () => handleMarkerClick(gym) }}
                >
                  {selectedGym?.id === gym.id && (
                    <Popup autoPan={false} className="gym-detail-popup">
                      <div className="font-sans w-72 overflow-hidden rounded-2xl shadow-xl border border-slate-100">
                        {/* Cover image - full width, no padding */}
                        <div className="relative h-40 bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center">
                          <Dumbbell className="h-16 w-16 text-white/40" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                          <button
                            onClick={() => {/* close */ setSelectedGym(null); }}
                            className="absolute top-2 right-2 w-8 h-8 bg-black/30 hover:bg-black/50 rounded-full flex items-center justify-center text-white text-lg font-bold"
                          >×</button>
                        </div>
                        {/* Content */}
                        <div className="p-4 space-y-3">
                          <div>
                            <h3 className="font-black text-lg text-slate-900 leading-tight">{gym.gym_name}</h3>
                            {/* Stars */}
                            <div className="flex items-center gap-1 mt-1">
                              {[1,2,3,4,5].map(star => (
                                <Star
                                  key={star}
                                  className={`h-4 w-4 ${star <= Math.floor(gym.rating || 0) ? "text-amber-400 fill-amber-400" : "text-slate-200"}`}
                                />
                              ))}
                              <span className="ml-1 text-sm font-semibold text-slate-600">{gym.rating?.toFixed(1) || "N/A"}</span>
                            </div>
                          </div>
                          {/* Info rows */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-3 text-sm text-slate-600">
                              <MapPin className="h-4 w-4 text-purple-500 flex-shrink-0" />
                              <span>{gym.city || "Location available in app"}</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-slate-600">
                              <Users className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                              <span>{gym.active_members_footfall || "N/A"} Footfall</span>
                            </div>
                          </div>
                          {/* Action buttons */}
                          <div className="flex gap-2 pt-1">
                            <button
                              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold text-slate-700 transition-colors"
                            >
                              <Share2 className="h-4 w-4" />
                              Share
                            </button>
                            <button
                              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-purple-600 hover:bg-purple-700 rounded-xl text-sm font-bold text-white transition-colors"
                            >
                              <Navigation className="h-4 w-4" />
                              Directions
                            </button>
                          </div>
                          <Button
                            size="sm"
                            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold mt-1"
                            onClick={() => handleJoinClick(gym.id)}
                            disabled={isJoining}
                          >
                            {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join this Gym"}
                          </Button>
                        </div>
                      </div>
                    </Popup>
                  )}
                </Marker>
              );
            })}
          </MapContainer>

          <div className="absolute top-4 right-4 z-[1000]">
            <Button size="icon" variant="outline" onClick={() => setIsMaximized(!isMaximized)} className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border-slate-200/80">
              {isMaximized ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
