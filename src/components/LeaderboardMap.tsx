'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { createClient } from '@supabase/supabase-js';
import { Phone, Star, MapPinned, Navigation2, Globe } from "lucide-react";

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Types ───────────────────────────────────────────────────────────────────
interface GymData {
  id: string;           // profiles.id
  gym_id: string | null;// profiles.gym_id
  gym_name: string;
  city: string;
  email: string;
  mobile_number: string;
  // from gym_profiles (joined on profiles.id = gym_profiles.gym_id)
  vibe_points: number | null;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  avatar_url: string | null;
  address: string | null;
  is_active: boolean;
  avg_rating?: number;
  review_count?: number;
}

interface Review {
  id: string;
  gym_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name?: string;
}

interface LeaderboardMapProps {
  currentUserId?: string;
}

// ─── Pulsing Marker SVG Factory ──────────────────────────────────────────────
function createPulsingIcon(vibePoints: number, rank: number) {
  const maxVibe = 2000;
  const intensity = Math.min((vibePoints || 0) / maxVibe, 1);
  // pulse speed: more vibe = faster pulse
  const duration = 3 - intensity * 1.5; // 1.5s to 3s
  // ring count: top gyms get 3 rings
  const rings = rank === 1 ? 3 : rank <= 3 ? 2 : 1;
  const color = rank === 1 ? '#FF3B30' : rank <= 3 ? '#FF6B35' : '#FF453A';

  const ringsSVG = Array.from({ length: rings }, (_, i) => {
    const delay = i * (duration / rings);
    const maxR = 28 + i * 12;
    return `
      <circle cx="20" cy="20" r="10" fill="none" stroke="${color}" stroke-width="${1.5 - i * 0.4}" opacity="0">
        <animate attributeName="r" values="10;${maxR}" dur="${duration}s" begin="${delay}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.8;0" dur="${duration}s" begin="${delay}s" repeatCount="indefinite"/>
      </circle>`;
  }).join('');

  const html = `
    <div style="position:relative;width:40px;height:40px">
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"
           style="position:absolute;top:0;left:0;overflow:visible">
        ${ringsSVG}
        <circle cx="20" cy="20" r="10" fill="${color}" stroke="white" stroke-width="2.5"/>
        <text x="20" y="24" text-anchor="middle" fill="white" font-size="10" font-weight="700" font-family="system-ui">${rank}</text>
      </svg>
    </div>`;

  return L.divIcon({
    html,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  });
}

// ─── Map click to close card ─────────────────────────────────────────────────
function MapClickHandler({ onClose }: { onClose: () => void }) {
  useMapEvents({ click: onClose });
  return null;
}

// ─── Fly to gym ──────────────────────────────────────────────────────────────
function FlyTo({ coords }: { coords: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (coords) map.flyTo(coords, 15, { duration: 1 });
  }, [coords, map]);
  return null;
}

// ─── Star Rating Component ────────────────────────────────────────────────────
function StarRating({
  value,
  onChange,
  readonly = false,
  size = 20,
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={(readonly ? value : hover || value) >= s ? '#FBBF24' : 'none'}
          stroke="#FBBF24"
          strokeWidth="1.8"
          style={{ cursor: readonly ? 'default' : 'pointer' }}
          onMouseEnter={() => !readonly && setHover(s)}
          onMouseLeave={() => !readonly && setHover(0)}
          onClick={() => !readonly && onChange?.(s)}
        >
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ))}
    </div>
  );
}

// ─── Google-style Gym Card ────────────────────────────────────────────────────
function GymCard({
  gym,
  reviews,
  currentUserId,
  onClose,
  onReviewSubmit,
  position,
}: {
  gym: GymData;
  reviews: Review[];
  currentUserId?: string;
  onClose: () => void;
  onReviewSubmit: () => void;
  position: { x: number; y: number };
}) {
  const [tab, setTab] = useState<'overview' | 'reviews'>('overview');
  const [newRating, setNewRating] = useState(0);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const openDirections = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: uLat, longitude: uLng } = pos.coords;
          const url = `https://www.google.com/maps/dir/$${uLat},${uLng}/${gym.latitude},${gym.longitude}`;
          window.open(url, '_blank');
        },
        () => {
          window.open(`https://www.google.com/maps/search/?api=1&query=$${gym.latitude},${gym.longitude}`, '_blank');
        }
      );
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=$${gym.latitude},${gym.longitude}`, '_blank');
    }
  };

  const submitReview = async () => {
    if (!currentUserId) { setSubmitError('Login required to review'); return; }
    if (newRating === 0) { setSubmitError('Please select a rating'); return; }
    setSubmitting(true);
    setSubmitError('');

    const { error } = await supabase.from('reviews').insert({
      gym_id: gym.id,
      user_id: currentUserId,
      rating: newRating,
      comment: newComment.trim() || null,
    });

    if (error) {
      setSubmitError(error.message);
    } else {
      setNewRating(0);
      setNewComment('');
      onReviewSubmit();
    }
    setSubmitting(false);
  };

  const avgRating = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

  // Position keeping it in frame
  const cardWidth = 360;
  const cardStyle: React.CSSProperties = {
    left: Math.min(position.x, window.innerWidth - cardWidth - 20),
    top: Math.min(position.y, window.innerHeight - 550),
  };

  const photoUrl = gym.logo_url || gym.avatar_url;

  return (
    <div 
      className="fixed z-[9999] w-[360px] bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] overflow-hidden font-sans border border-slate-100"
      style={cardStyle} 
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header Image (No padding, touches the edges) */}
      {photoUrl ? (
        <div className="relative h-48 w-full bg-slate-100">
          <img
            src={photoUrl}
            alt={gym.gym_name}
            className="w-full h-full object-cover"
          />
          {/* Floating Circle Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 bg-white/90 hover:bg-white text-slate-700 border-none rounded-full w-8 h-8 flex items-center justify-center shadow-md transition-all font-bold"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="relative h-36 bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
          <span className="text-4xl">🏋️</span>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 bg-white/90 hover:bg-white text-slate-700 border-none rounded-full w-8 h-8 flex items-center justify-center shadow-md transition-all font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Gym Info Header */}
      <div className="px-5 pt-4 pb-2">
        <h2 className="text-[22px] font-medium text-slate-900 leading-tight mb-1">
          {gym.gym_name}
        </h2>
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[14px] font-medium text-slate-700">
            {avgRating ? avgRating.toFixed(1) : '—'}
          </span>
          <StarRating value={Math.round(avgRating)} readonly size={15} />
          <span className="text-[13px] text-slate-500 ml-1">({reviews.length})</span>
          <span className="text-[13px] text-slate-500">· Gym</span>
        </div>
        
        {/* Vibe Points Badge */}
        <div className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-100 px-3 py-1 rounded-full text-xs font-bold">
          🔥 {gym.vibe_points?.toLocaleString() ?? 0} vibe pts
        </div>
      </div>

      {/* Action Buttons Row (Google Maps Style) */}
      <div className="flex justify-around items-center py-3 border-b border-slate-100">
        <button onClick={openDirections} className="flex flex-col items-center gap-1.5 group outline-none">
          <div className="w-10 h-10 rounded-full bg-[#1A73E8] flex items-center justify-center text-white shadow-sm group-hover:bg-blue-700 transition">
            <Navigation2 className="w-5 h-5 fill-current" />
          </div>
          <span className="text-[12px] font-medium text-[#1A73E8]">Directions</span>
        </button>

        <button onClick={() => setTab('reviews')} className="flex flex-col items-center gap-1.5 group outline-none">
          <div className="w-10 h-10 rounded-full bg-[#E8F0FE] flex items-center justify-center text-[#1A73E8] group-hover:bg-[#d2e3fc] transition">
            <Star className="w-[18px] h-[18px]" />
          </div>
          <span className="text-[12px] font-medium text-[#1A73E8]">Reviews</span>
        </button>

        {gym.mobile_number && (
          <button onClick={() => window.open(`tel:${gym.mobile_number}`)} className="flex flex-col items-center gap-1.5 group outline-none">
            <div className="w-10 h-10 rounded-full bg-[#E8F0FE] flex items-center justify-center text-[#1A73E8] group-hover:bg-[#d2e3fc] transition">
              <Phone className="w-[18px] h-[18px]" />
            </div>
            <span className="text-[12px] font-medium text-[#1A73E8]">Call</span>
          </button>
        )}
      </div>

      {/* Tabs Row */}
      <div className="flex border-b border-slate-100">
        {(['overview', 'reviews'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-[13px] font-medium capitalize outline-none transition-colors ${
              tab === t
                ? 'text-[#1A73E8] border-b-[3px] border-[#1A73E8]'
                : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Scrollable Tab Content */}
      <div className="px-5 py-4 max-h-[250px] overflow-y-auto bg-white scrollbar-hide">
        {tab === 'overview' ? (
          <div className="flex flex-col gap-5">
            {gym.address && (
              <div className="flex items-start gap-4">
                <MapPinned className="w-5 h-5 text-[#1A73E8] shrink-0 mt-0.5" />
                <span className="text-[14px] text-slate-700 leading-snug">{gym.address}</span>
              </div>
            )}
            {gym.mobile_number && (
              <div className="flex items-center gap-4">
                <Phone className="w-5 h-5 text-[#1A73E8] shrink-0" />
                <a href={`tel:${gym.mobile_number}`} className="text-[14px] text-[#1A73E8] hover:underline">
                  {gym.mobile_number}
                </a>
              </div>
            )}
            <div className="flex items-center gap-4">
              <Globe className="w-5 h-5 text-[#1A73E8] shrink-0" />
              <span className="text-[14px] text-slate-700">{gym.city}</span>
            </div>
            <div className="flex items-center gap-4 pt-1">
              <div className={`w-2.5 h-2.5 rounded-full ${gym.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className={`text-[14px] font-medium ${gym.is_active ? 'text-green-700' : 'text-red-700'}`}>
                {gym.is_active ? 'Currently active & open' : 'Currently closed'}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Write a review */}
            {currentUserId && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[13px] font-bold text-slate-800 mb-2">Rate & Review</div>
                <StarRating value={newRating} onChange={setNewRating} size={24} />
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Share details of your own experience at this gym"
                  className="w-full mt-3 p-3 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:border-[#1A73E8] focus:ring-1 focus:ring-[#1A73E8] transition-all bg-white"
                  rows={2}
                />
                {submitError && <div className="text-xs text-red-500 mt-2 font-medium">{submitError}</div>}
                <div className="flex justify-end mt-3">
                  <button
                    onClick={submitReview}
                    disabled={submitting}
                    className="px-5 py-2 bg-[#1A73E8] text-white rounded-full text-[13px] font-medium hover:bg-blue-700 transition disabled:opacity-50 shadow-sm"
                  >
                    {submitting ? 'Posting...' : 'Post review'}
                  </button>
                </div>
              </div>
            )}

            {/* Existing reviews */}
            {reviews.length === 0 ? (
              <div className="text-center py-6 text-slate-500">
                <div className="text-3xl mb-2">📝</div>
                <div className="text-[13px] font-medium">No reviews yet. Be the first!</div>
              </div>
            ) : (
              <div className="space-y-4">
                {reviews.map((r) => (
                  <div key={r.id} className="pb-4 border-b border-slate-100 last:border-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <StarRating value={r.rating} readonly size={14} />
                      <span className="text-[11px] text-slate-400 font-medium">
                        {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    {r.comment && <p className="text-[13px] text-slate-700 leading-relaxed mt-1">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LeaderboardMap({ currentUserId }: LeaderboardMapProps) {
  const [gyms, setGyms] = useState<GymData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGym, setSelectedGym] = useState<GymData | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [cardPos, setCardPos] = useState({ x: 100, y: 100 });
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);
  const markersRef = useRef<Map<string, L.DivIcon>>(new Map());

  // ── Fetch all gyms with vibe points ──
  const fetchGyms = useCallback(async () => {
    setLoading(true);
    // Join profiles + gym_profiles. profiles.id = gym_profiles.gym_id
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id,
        gym_id,
        gym_name,
        city,
        email,
        mobile_number,
        gym_profiles!profiles_id_fkey (
          vibe_points,
          latitude,
          longitude,
          logo_url,
          avatar_url,
          address,
          is_active
        )
      `)
      .not('gym_profiles', 'is', null);

    if (error) { console.error('Error fetching gyms:', error); setLoading(false); return; }

    // Flatten
    const flat: GymData[] = (data || []).map((row: any) => {
      const gp = Array.isArray(row.gym_profiles) ? row.gym_profiles[0] : row.gym_profiles;
      return {
        id: row.id,
        gym_id: row.gym_id,
        gym_name: row.gym_name,
        city: row.city,
        email: row.email,
        mobile_number: row.mobile_number,
        vibe_points: gp?.vibe_points ?? 0,
        latitude: gp?.latitude ?? null,
        longitude: gp?.longitude ?? null,
        logo_url: gp?.logo_url ?? null,
        avatar_url: gp?.avatar_url ?? null,
        address: gp?.address ?? null,
        is_active: gp?.is_active ?? false,
      };
    });

    // Sort by vibe_points desc
    flat.sort((a, b) => (b.vibe_points ?? 0) - (a.vibe_points ?? 0));

    // Fetch avg rating per gym
    const ids = flat.map((g) => g.id);
    if (ids.length > 0) {
      const { data: rData } = await supabase
        .from('reviews')
        .select('gym_id, rating')
        .in('gym_id', ids);

      if (rData) {
        const ratingMap: Record<string, { sum: number; count: number }> = {};
        rData.forEach((r: any) => {
          if (!ratingMap[r.gym_id]) ratingMap[r.gym_id] = { sum: 0, count: 0 };
          ratingMap[r.gym_id].sum += r.rating;
          ratingMap[r.gym_id].count += 1;
        });
        flat.forEach((g) => {
          if (ratingMap[g.id]) {
            g.avg_rating = ratingMap[g.id].sum / ratingMap[g.id].count;
            g.review_count = ratingMap[g.id].count;
          }
        });
      }
    }

    setGyms(flat);
    setLoading(false);
  }, []);

  useEffect(() => { fetchGyms(); }, [fetchGyms]);

  // ── Fetch reviews for selected gym ──
  const fetchReviews = useCallback(async (gymId: string) => {
    const { data } = await supabase
      .from('reviews')
      .select('*')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false });
    setReviews(data ?? []);
  }, []);

  useEffect(() => {
    if (selectedGym) fetchReviews(selectedGym.id);
  }, [selectedGym, fetchReviews]);

  const handleMarkerClick = (gym: GymData, e: L.LeafletMouseEvent) => {
    const containerPoint = e.containerPoint;
    const mapContainer = e.target._map.getContainer();
    const rect = mapContainer.getBoundingClientRect();
    setCardPos({
      x: rect.left + containerPoint.x + 10,
      y: rect.top + containerPoint.y - 80,
    });
    setSelectedGym(gym);
    setFlyTo([gym.latitude!, gym.longitude!]);
  };

  const validGyms = gyms.filter((g) => g.latitude != null && g.longitude != null);
  const center: [number, number] = validGyms.length > 0
    ? [validGyms[0].latitude!, validGyms[0].longitude!]
    : [27.8974, 78.0880];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.7)',
        }}>
          <span style={{ fontSize: 14, color: '#666' }}>Loading gyms...</span>
        </div>
      )}

      <MapContainer
        center={center}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <MapClickHandler onClose={() => setSelectedGym(null)} />
        <FlyTo coords={flyTo} />

        {validGyms.map((gym, idx) => {
          const rank = idx + 1;
          const icon = createPulsingIcon(gym.vibe_points ?? 0, rank);
          markersRef.current.set(gym.id, icon);
          return (
            <Marker
              key={gym.id}
              position={[gym.latitude!, gym.longitude!]}
              icon={icon}
              eventHandlers={{
                click: (e) => handleMarkerClick(gym, e),
              }}
            />
          );
        })}
      </MapContainer>

      {/* Google-style card */}
      {selectedGym && (
        <GymCard
          gym={selectedGym}
          reviews={reviews}
          currentUserId={currentUserId}
          onClose={() => setSelectedGym(null)}
          onReviewSubmit={() => {
            fetchReviews(selectedGym.id);
            fetchGyms();
          }}
          position={cardPos}
        />
      )}
    </div>
  );
}
