import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Search, Star, LocateFixed, Maximize2, Minimize2, Dumbbell, MapPin,
  Navigation, CheckCircle2, Bookmark, Share2, Clock, Phone, Send,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { createDefaultMarkerIcon } from "@/lib/leafletDefaultIcon";
import { cn } from "@/lib/utils";

// Explicit stock blue pin, passed to every <Marker> so the icon always resolves.
const defaultIcon = createDefaultMarkerIcon(L) as L.Icon;

// Haversine formula to calculate distance between two lat/lon points in km
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
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
  address?: string;
  contact_number?: string;
  logo_url?: string | null;
  gym_photos?: string[];
  opening_time?: string;
  closing_time?: string;
  description?: string;
  distance?: number;
}

interface ReviewRow {
  id: string;
  member_id: string;
  rating: number;
  comment: string;
  created_at: string;
}

interface EnrolledGym {
  id: string;
  gym_name: string;
  latitude: number | null;
  longitude: number | null;
  city?: string;
}

const ALIGARH_CENTER: L.LatLngExpression = [27.8974, 78.0880];

// Parse "06:00", "6:00 AM", "22:00" -> minutes since midnight (or null).
const parseTimeToMinutes = (t?: string): number | null => {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
};

const openState = (gym: GymData): { label: string; open: boolean } | null => {
  const open = parseTimeToMinutes(gym.opening_time);
  const close = parseTimeToMinutes(gym.closing_time);
  if (open == null || close == null) {
    if (gym.opening_time || gym.closing_time) {
      return { label: `${gym.opening_time || '?'} – ${gym.closing_time || '?'}`, open: true };
    }
    return null;
  }
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  // Handle overnight ranges (e.g. opens 06:00, closes 23:00 is normal; closes < open wraps midnight)
  const isOpen = close > open ? (mins >= open && mins < close) : (mins >= open || mins < close);
  return {
    label: isOpen ? `Open · Closes ${gym.closing_time}` : `Closed · Opens ${gym.opening_time}`,
    open: isOpen,
  };
};

// Google-Maps style: hide markers at world/country zoom, reveal them as you zoom
// into a city. Markers use the default Leaflet blue pin.
const MARKER_ZOOM = 10;

// Tracks the map zoom so the parent can hide markers when zoomed out (and syncs on mount).
const ZoomWatcher = ({ onZoom }: { onZoom: (z: number) => void }) => {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => { onZoom(map.getZoom()); }, [map, onZoom]);
  return null;
};

const MapController = ({ center, isMaximized }: { center: L.LatLngExpression | null, isMaximized: boolean }) => {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, 15, { animate: true, duration: 1.5 });
  }, [center, map]);
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 400);
    return () => clearTimeout(timer);
  }, [isMaximized, map]);
  return null;
};

const Stars = ({ value, size = "h-4 w-4" }: { value: number; size?: string }) => (
  <div className="flex items-center">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={cn(size, s <= Math.round(value) ? "text-amber-400 fill-amber-400" : "text-slate-200")} />
    ))}
  </div>
);

export function CityGymExplorer({ onJoinGym, currentGymId, currentGym, currentUserId }: {
  onJoinGym: (gymId: string) => void;
  currentGymId?: string;
  currentGym?: EnrolledGym;
  currentUserId?: string;
}) {
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
  const [zoom, setZoom] = useState(13);

  // Reviews state (per selected gym, realtime).
  const [detailTab, setDetailTab] = useState<'overview' | 'reviews'>('overview');
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchGyms = useCallback(async () => {
    setIsLoading(true);
    try {
      // gym_settings is where the OWNER saves coordinates + gym details.
      const { data, error } = await supabase
        .from("gym_settings")
        .select("id, gym_name, latitude, longitude, city, address, contact_number, logo_url, gym_photos, opening_time, closing_time, description");

      if (error) throw error;

      const validGyms: GymData[] = (data || [])
        .map((gym) => ({
          id: gym.id,
          gym_name: gym.gym_name,
          city: gym.city,
          address: gym.address,
          contact_number: gym.contact_number,
          logo_url: gym.logo_url,
          gym_photos: Array.isArray(gym.gym_photos) ? gym.gym_photos : [],
          opening_time: gym.opening_time,
          closing_time: gym.closing_time,
          description: gym.description,
          latitude: gym.latitude == null ? null : Number(gym.latitude),
          longitude: gym.longitude == null ? null : Number(gym.longitude),
        }))
        .filter((gym) => {
          if (gym.latitude == null || Number.isNaN(gym.latitude) || gym.longitude == null || Number.isNaN(gym.longitude)) {
            console.warn(`Gym "${gym.gym_name}" (ID: ${gym.id}) has no saved coordinates.`);
            return false;
          }
          return true;
        });

      let merged = validGyms;
      if (
        currentGym && currentGym.latitude != null && currentGym.longitude != null &&
        !merged.some((g) => g.id === currentGym.id)
      ) {
        merged = [{
          id: currentGym.id,
          gym_name: currentGym.gym_name,
          latitude: currentGym.latitude,
          longitude: currentGym.longitude,
          city: currentGym.city,
        }, ...merged];
      }

      setAllGyms(merged);
    } catch (error: any) {
      toast.error("Failed to fetch gyms.", { description: error.message });
    } finally {
      setIsLoading(false);
    }
  }, [currentGym]);

  useEffect(() => {
    fetchGyms();
  }, [fetchGyms]);

  // Center the map on the member's enrolled gym when it loads — but DON'T open
  // its detail card. The card only opens when the user taps a marker / list item.
  const centeredOnEnrolledRef = useRef(false);
  useEffect(() => {
    if (centeredOnEnrolledRef.current) return;
    if (currentGymId && allGyms.length) {
      const mine = allGyms.find(g => g.id === currentGymId);
      if (mine && mine.latitude && mine.longitude) {
        setMapCenter([mine.latitude, mine.longitude]);
        centeredOnEnrolledRef.current = true;
      }
    }
  }, [currentGymId, allGyms]);

  // Load + live-subscribe to reviews for the selected gym.
  useEffect(() => {
    if (!selectedGym) { setReviews([]); return; }
    const gymId = selectedGym.id;
    setDetailTab('overview');
    setMyRating(0);
    setMyComment("");
    let active = true;

    const load = async () => {
      setReviewsLoading(true);
      const { data, error } = await supabase
        .from('reviews')
        .select('id, member_id, rating, comment, created_at')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (active && !error) setReviews(data || []);
      if (active) setReviewsLoading(false);
    };
    load();

    const channel = supabase
      .channel(`gym-reviews-${gymId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `gym_id=eq.${gymId}` }, () => load())
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [selectedGym?.id]);

  const avgRating = useMemo(
    () => (reviews.length ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0),
    [reviews]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedGym) setSelectedGym(null);
        else if (isMaximized) setIsMaximized(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMaximized, selectedGym]);

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
      gym.gym_name.toLowerCase().includes(query) || (gym.city && gym.city.toLowerCase().includes(query))
    );
  }, [allGyms, gymsWithDistance, searchQuery, filterMode]);

  const showGymDetails = (gym: GymData) => {
    setSelectedGym(gym);
    if (gym.latitude && gym.longitude) setMapCenter([gym.latitude, gym.longitude]);
  };

  const openDirections = (gym: GymData) => {
    if (gym.latitude && gym.longitude) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${gym.latitude},${gym.longitude}`, '_blank', 'noopener');
    } else {
      toast.error("Location unavailable for this gym.");
    }
  };

  const shareGym = async (gym: GymData) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${gym.latitude},${gym.longitude}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: gym.gym_name, text: `Check out ${gym.gym_name}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
      }
    } catch { /* user cancelled share */ }
  };

  const handleJoinClick = async (gymId: string) => {
    setIsJoining(true);
    try {
      await onJoinGym(gymId);
    } finally {
      setIsJoining(false);
    }
  };

  const submitReview = async () => {
    if (!currentUserId) { toast.error("Sign in to leave a review."); return; }
    if (!selectedGym) return;
    if (myRating < 1) { toast.error("Pick a star rating."); return; }
    if (!myComment.trim()) { toast.error("Write a short review."); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('reviews').insert({
        member_id: currentUserId,
        gym_id: selectedGym.id,
        rating: myRating,
        comment: myComment.trim(),
      });
      if (error) throw error;
      setMyRating(0);
      setMyComment("");
      toast.success("Review posted!");
      // realtime listener refreshes the list automatically.
    } catch (e: any) {
      toast.error("Failed to post review.", { description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const isEnrolledSelected = selectedGym && currentGymId === selectedGym.id;
  const cover = selectedGym?.gym_photos?.[0] || selectedGym?.logo_url || null;
  const hours = selectedGym ? openState(selectedGym) : null;

  // Small Google-Maps-style action button.
  const ActionButton = ({ icon: Icon, label, onClick, active }: { icon: React.ElementType; label: string; onClick: () => void; active?: boolean }) => (
    <button onClick={onClick} className="flex flex-col items-center gap-1 text-indigo-600">
      <span className={cn("flex h-11 w-11 items-center justify-center rounded-full transition-colors", active ? "bg-indigo-600 text-white" : "bg-indigo-50 hover:bg-indigo-100")}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
    </button>
  );

  return (
    <div className={cn(
      "relative rounded-3xl lg:rounded-[3rem] border border-slate-200/60 bg-white shadow-elegant overflow-hidden w-full",
      isMaximized ? "fixed inset-0 z-9999 rounded-none" : "lg:h-[75vh] lg:min-h-125"
    )}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,1fr)_2fr] h-full">

        {!isMaximized && (
          <div className="flex flex-col lg:h-full border-b lg:border-b-0 lg:border-r border-slate-200/60">
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

            <div className="flex-1 overflow-y-auto p-2 max-h-[38vh] lg:max-h-none">
              {isLoading ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
              ) : filteredGyms.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 px-4">
                  <Search className="h-8 w-8 mb-2" />
                  <p className="text-sm">No gyms found. Try a different search.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredGyms.map((gym) => {
                    const isEnrolled = currentGymId === gym.id;
                    return (
                      <div
                        key={gym.id}
                        className={cn(
                          'w-full p-3 rounded-2xl transition-colors flex items-center justify-between gap-2',
                          selectedGym?.id === gym.id ? 'bg-primary/10' : 'hover:bg-slate-50'
                        )}
                      >
                        <button onClick={() => showGymDetails(gym)} className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-800 truncate">{gym.gym_name}</p>
                            {isEnrolled && (
                              <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">Enrolled</span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-slate-500">
                            {filterMode === 'nearMe' && gym.distance !== undefined
                              ? `${gym.distance.toFixed(2)} km away`
                              : (gym.city || 'Tap for details & reviews')}
                          </p>
                        </button>
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs" onClick={() => showGymDetails(gym)}>Details</Button>
                          {isEnrolled ? (
                            <span className="flex items-center justify-center gap-1 text-xs font-semibold text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Joined
                            </span>
                          ) : (
                            <Button size="sm" className="h-8 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-700" onClick={() => handleJoinClick(gym.id)} disabled={isJoining}>
                              {isJoining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Join"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className={cn("relative w-full", isMaximized ? "h-full" : "h-[55vh] lg:h-full")}>
          <MapContainer center={ALIGARH_CENTER} zoom={13} className="w-full h-full z-0 rounded-2xl overflow-hidden shadow-sm">
            <MapController center={mapCenter} isMaximized={isMaximized} />
            <ZoomWatcher onZoom={setZoom} />
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />

            {userLocation && filterMode === 'nearMe' && (
              <Circle center={[userLocation.lat, userLocation.lon]} radius={2000} pathOptions={{ color: '#8B5CF6', fillColor: '#8B5CF6', fillOpacity: 0.1 }} />
            )}
            {filteredGyms.map((gym) => {
              if (!gym.latitude || !gym.longitude) return null;
              // Hide markers when zoomed out, but always keep the selected gym visible.
              if (zoom < MARKER_ZOOM && gym.id !== selectedGym?.id) return null;
              return (
                <Marker
                  key={gym.id}
                  position={[gym.latitude, gym.longitude]}
                  icon={defaultIcon}
                  eventHandlers={{ click: () => showGymDetails(gym) }}
                />
              );
            })}
          </MapContainer>

          {/* Google-Maps-style place card */}
          {selectedGym && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 w-[92%] max-w-sm">
              <div className="flex max-h-[78vh] flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
                {/* Cover */}
                <div className="relative h-40 shrink-0">
                  {cover ? (
                    <img src={cover} alt={selectedGym.gym_name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-purple-600 to-indigo-700">
                      <Dumbbell className="h-14 w-14 text-white/40" />
                    </div>
                  )}
                  <button
                    onClick={() => setSelectedGym(null)}
                    className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-lg font-bold leading-none text-white hover:bg-black/60"
                    aria-label="Close"
                  >×</button>
                  {isEnrolledSelected && (
                    <span className="absolute top-2 left-2 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white">Your Gym</span>
                  )}
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-3 p-4">
                    <div>
                      <h3 className="text-xl font-black leading-tight text-slate-900">{selectedGym.gym_name}</h3>
                      <div className="mt-1 flex items-center gap-2 text-sm">
                        <span className="font-bold text-amber-500">{avgRating ? avgRating.toFixed(1) : '—'}</span>
                        <Stars value={avgRating} />
                        <span className="text-slate-400">({reviews.length})</span>
                      </div>
                      <p className="text-xs text-slate-400">Gym</p>
                    </div>

                    {/* Action row */}
                    <div className="flex items-start justify-around border-y border-slate-100 py-3">
                      <ActionButton icon={Navigation} label="Directions" onClick={() => openDirections(selectedGym)} />
                      {isEnrolledSelected ? (
                        <ActionButton icon={CheckCircle2} label="Joined" onClick={() => {}} active />
                      ) : (
                        <ActionButton icon={Bookmark} label="Join" onClick={() => handleJoinClick(selectedGym.id)} />
                      )}
                      <ActionButton icon={Share2} label="Share" onClick={() => shareGym(selectedGym)} />
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-4 border-b border-slate-100 text-sm font-semibold">
                      {(['overview', 'reviews'] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setDetailTab(tab)}
                          className={cn(
                            "-mb-px border-b-2 pb-2 capitalize transition-colors",
                            detailTab === tab ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"
                          )}
                        >
                          {tab === 'reviews' ? `Reviews (${reviews.length})` : 'Overview'}
                        </button>
                      ))}
                    </div>

                    {detailTab === 'overview' ? (
                      <div className="space-y-2.5 pt-1">
                        {selectedGym.address && (
                          <div className="flex items-start gap-3 text-sm text-slate-600">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
                            <span>{selectedGym.address}{selectedGym.city ? `, ${selectedGym.city}` : ''}</span>
                          </div>
                        )}
                        {hours && (
                          <div className="flex items-center gap-3 text-sm">
                            <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className={cn("font-medium", hours.open ? "text-emerald-600" : "text-red-500")}>{hours.label}</span>
                          </div>
                        )}
                        {selectedGym.contact_number && (
                          <a href={`tel:${selectedGym.contact_number}`} className="flex items-center gap-3 text-sm text-slate-600 hover:text-indigo-600">
                            <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                            <span>{selectedGym.contact_number}</span>
                          </a>
                        )}
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                          <Navigation className="h-4 w-4 shrink-0 text-slate-400" />
                          <span>{selectedGym.latitude?.toFixed(5)}, {selectedGym.longitude?.toFixed(5)}</span>
                        </div>
                        {selectedGym.distance !== undefined && (
                          <p className="text-xs text-slate-400">{selectedGym.distance.toFixed(2)} km away</p>
                        )}
                        {selectedGym.description && (
                          <p className="pt-1 text-sm leading-relaxed text-slate-500">{selectedGym.description}</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4 pt-1">
                        {/* Write a review */}
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-600">Rate this gym</p>
                          <div className="mt-1 flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <button key={s} onClick={() => setMyRating(s)} aria-label={`${s} star`}>
                                <Star className={cn("h-6 w-6 transition-colors", s <= myRating ? "text-amber-400 fill-amber-400" : "text-slate-300 hover:text-amber-300")} />
                              </button>
                            ))}
                          </div>
                          <Textarea
                            value={myComment}
                            onChange={(e) => setMyComment(e.target.value)}
                            placeholder="Share your experience..."
                            className="mt-2 min-h-16 resize-none bg-white text-sm"
                          />
                          <Button onClick={submitReview} disabled={submitting} size="sm" className="mt-2 w-full rounded-lg bg-indigo-600 hover:bg-indigo-700">
                            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Post review
                          </Button>
                        </div>

                        {/* Review list */}
                        {reviewsLoading ? (
                          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-indigo-500" /></div>
                        ) : reviews.length === 0 ? (
                          <p className="py-2 text-center text-sm text-slate-400">No reviews yet. Be the first!</p>
                        ) : (
                          <ul className="space-y-3">
                            {reviews.map((r) => (
                              <li key={r.id} className="border-b border-slate-50 pb-3 last:border-0">
                                <div className="flex items-center justify-between">
                                  <Stars value={r.rating} size="h-3.5 w-3.5" />
                                  <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()}</span>
                                </div>
                                <p className="mt-1 text-sm text-slate-700">{r.comment}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="absolute top-4 right-4 z-1000">
            <Button size="icon" variant="outline" onClick={() => setIsMaximized(!isMaximized)} className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border-slate-200/80">
              {isMaximized ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
