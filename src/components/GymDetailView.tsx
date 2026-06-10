import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { LegalLinksFooter } from "@/components/LegalLinksFooter";
import {
  ChevronLeft,
  ChevronRight,
  Star,
  Clock,
  Phone,
  MapPin,
  Share2,
  Flame,
  Users,
  LogIn,
  ImageOff,
  CircleDashed,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useGymLiveStats } from "@/hooks/useGymLiveStats";

interface GymDetail {
  id: string;
  gym_name: string;
  city: string;
  opening_time?: string;
  closing_time?: string;
  phone_number?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  review_count?: number;
  gym_photos?: string[];
  gym_videos?: string[];
  total_calories?: number;
  active_members?: number;
  description?: string;
  terms_url?: string | null;
  privacy_url?: string | null;
  refund_url?: string | null;
}

export function GymDetailView({ gymId, memberId }: { gymId: string; memberId?: string }) {
  const navigate = useNavigate();
  const [gym, setGym] = useState<GymDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [memberGymId, setMemberGymId] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Live "today" community stats, kept fresh via Supabase realtime + polling.
  const { stats, isLoading: statsLoading } = useGymLiveStats(gymId);

  // ✅ Fetch gym details
  useEffect(() => {
    const fetchGymDetails = async () => {
      try {
        setIsLoading(true);

        // Try gym_settings first, fallback to gym_profiles
        let { data: gymData, error: settingsError } = await supabase
          .from("gym_settings")
          .select("*")
          .eq("id", gymId)
          .maybeSingle();

        if (!gymData && settingsError) {
          const { data: profileData } = await supabase
            .from("gym_profiles")
            .select("*")
            .eq("id", gymId)
            .maybeSingle();
          gymData = profileData;
        }

        if (gymData) {
          setGym(gymData);
        } else {
          toast.error("Gym not found");
          navigate({ to: "/city-leaderboard" });
        }

        // Get member's current gym if provided
        if (memberId) {
          const { data: memberData } = await supabase
            .from("members")
            .select("gym_id")
            .eq("id", memberId)
            .maybeSingle();
          setMemberGymId(memberData?.gym_id || null);
        }
      } catch (error) {
        console.error("Error fetching gym details:", error);
        toast.error("Could not load gym details");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchGymDetails();
  }, [gymId, memberId, navigate]);

  // ✅ Handle Join Gym
  const handleJoinGym = async () => {
    if (!memberId) {
      toast.error("Please login to join a gym");
      return;
    }

    setIsJoining(true);
    try {
      // 1. Get owner ID for consistency
      const { data: gymData } = await supabase
        .from("gym_settings")
        .select("gym_owner_id")
        .eq("id", gymId)
        .maybeSingle();

      // 2. Update members table
      const { error: memberError } = await supabase
        .from("members")
        .update({ 
          gym_id: gymId,
          gym_owner_id: gymData?.gym_owner_id || null
        })
        .eq("id", memberId);

      if (memberError) throw memberError;

      // 3. Update profiles table for consistency
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ gym_id: gymId })
        .eq("id", memberId);

      if (profileError) {
        console.warn("Could not update profile gym_id:", profileError);
      }

      setMemberGymId(gymId);
      toast.success(`✅ Welcome to ${gym?.gym_name}!`);
      
      // Navigate back to dashboard to see the changes
      navigate({ to: "/member-dashboard" });
    } catch (error) {
      console.error("Error joining gym:", error);
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsJoining(false);
    }
  };

  // ✅ Handle Share
  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/gym-detail/${gymId}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: gym?.gym_name,
          text: `Check out ${gym?.gym_name} on Gymphony!`,
          url: shareUrl,
        });
      } catch (error) {
        console.error("Share error:", error);
      }
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied to clipboard!");
    }
  };

  // ✅ Handle Directions
  const handleDirections = () => {
    if (gym?.latitude && gym?.longitude) {
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${gym.latitude},${gym.longitude}`;
      window.open(mapsUrl, "_blank");
    } else {
      toast.error("Location not available");
    }
  };

  // ✅ Handle Call
  const handleCall = () => {
    if (gym?.phone_number) {
      window.location.href = `tel:${gym.phone_number}`;
    } else {
      toast.error("Phone number not available");
    }
  };

  const photos = gym?.gym_photos || [];
  const videos = gym?.gym_videos || [];

  const openVideoFullscreen = useCallback((videoEl: HTMLVideoElement) => {
    if (videoEl.requestFullscreen) {
      void videoEl.requestFullscreen();
      return;
    }

    const anyVideo = videoEl as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (typeof anyVideo.webkitEnterFullscreen === "function") {
      anyVideo.webkitEnterFullscreen();
    }
  }, []);

  const goToPhoto = (next: number) => {
    const count = Math.max(photos.length, 1);
    setPhotoLoaded(false);
    setCurrentPhotoIndex(((next % count) + count) % count);
  };
  const nextPhoto = () => goToPhoto(currentPhotoIndex + 1);
  const prevPhoto = () => goToPhoto(currentPhotoIndex - 1);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <Card className="rounded-3xl border-slate-200 bg-white">
            <CardContent className="flex items-center justify-center gap-3 p-12">
              <CircleDashed className="h-5 w-5 animate-spin text-[#8B5CF6]" />
              <p className="text-slate-600">Loading gym details...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!gym) {
    return null;
  }

  const isMyGym = memberGymId === gymId;
  const photoUrl = photos[currentPhotoIndex] || "https://via.placeholder.com/800x400?text=Gym+Photo";

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-6xl">
        {/* ✅ BACK BUTTON */}
        <Button
          variant="ghost"
          onClick={() => navigate({ to: "/city-leaderboard" })}
          className="mb-6 gap-2 text-slate-600 hover:bg-white rounded-2xl"
        >
          <ChevronLeft className="h-5 w-5" />
          Back to Leaderboard
        </Button>

        {/* ✅ PHOTO CAROUSEL — skeleton while each frame decodes, premium empty state */}
        <Card className="rounded-3xl border-slate-200 bg-white shadow-sm overflow-hidden mb-6">
          <div className="relative h-96 w-full overflow-hidden bg-slate-100">
            {photos.length > 0 ? (
              <>
                {/* Shimmer skeleton stays until the active frame finishes loading */}
                {!photoLoaded && (
                  <div className="absolute inset-0 z-10">
                    <Skeleton className="h-full w-full rounded-none bg-slate-200/80" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <CircleDashed className="h-8 w-8 animate-spin text-slate-400" />
                    </div>
                  </div>
                )}
                <motion.img
                  key={currentPhotoIndex}
                  src={photoUrl}
                  alt={`${gym.gym_name} - Photo ${currentPhotoIndex + 1}`}
                  onLoad={() => setPhotoLoaded(true)}
                  onError={() => setPhotoLoaded(true)}
                  className="h-full w-full object-cover"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: photoLoaded ? 1 : 0 }}
                  transition={{ duration: 0.4 }}
                />
                {/* Subtle gradient so overlaid controls stay legible */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-black/35 to-transparent" />
              </>
            ) : (
              /* "No photos available" — skeleton tiles + clear empty state */
              <div className="absolute inset-0">
                <div className="grid h-full grid-cols-3 gap-2 p-2 opacity-60">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-full w-full rounded-2xl bg-slate-200/80" />
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-2xl bg-white/80 px-6 py-5 text-center shadow-sm backdrop-blur-sm">
                    <ImageOff className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                    <p className="font-semibold text-slate-500">No photos available</p>
                    <p className="text-xs text-slate-400">This gym hasn&apos;t added photos yet</p>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation Arrows + dot indicators */}
            {photos.length > 1 && (
              <>
                <button
                  onClick={prevPhoto}
                  aria-label="Previous photo"
                  className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-lg backdrop-blur-sm transition hover:scale-105 hover:bg-white"
                >
                  <ChevronLeft className="h-5 w-5 text-slate-900" />
                </button>
                <button
                  onClick={nextPhoto}
                  aria-label="Next photo"
                  className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-lg backdrop-blur-sm transition hover:scale-105 hover:bg-white"
                >
                  <ChevronRight className="h-5 w-5 text-slate-900" />
                </button>

                {/* Dot indicators */}
                <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">
                  {photos.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => goToPhoto(i)}
                      aria-label={`Go to photo ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all ${
                        i === currentPhotoIndex ? "w-6 bg-white" : "w-1.5 bg-white/60 hover:bg-white/80"
                      }`}
                    />
                  ))}
                </div>

                {/* Photo Count */}
                <div className="absolute bottom-4 right-4 z-20 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                  {currentPhotoIndex + 1} / {photos.length}
                </div>
              </>
            )}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column: Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* ✅ GYM HEADER WITH RATING */}
            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="p-6 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="text-4xl font-bold text-slate-900">{gym.gym_name}</CardTitle>
                    <p className="text-slate-600 mt-1 flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {gym.city}
                    </p>
                  </div>

                  {/* Rating Badge */}
                  <div className="text-right">
                    <div className="flex items-center gap-2 mb-2">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className={`h-5 w-5 ${
                            i < Math.floor(gym.rating || 4.5)
                              ? "fill-yellow-400 text-yellow-400"
                              : "fill-slate-200 text-slate-200"
                          }`}
                        />
                      ))}
                    </div>
                    <Badge className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-bold">
                      ⭐ {gym.rating || 4.5}
                    </Badge>
                    <p className="text-xs text-slate-500 mt-1">{gym.review_count || 0} reviews</p>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* ✅ ACTION BUTTONS */}
            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="grid gap-3 grid-cols-3">
                  <Button
                    onClick={handleCall}
                    className="rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-semibold h-12 gap-2"
                    variant="outline"
                  >
                    <Phone className="h-5 w-5" />
                    Call
                  </Button>
                  <Button
                    onClick={handleDirections}
                    className="rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-semibold h-12 gap-2"
                    variant="outline"
                  >
                    <MapPin className="h-5 w-5" />
                    Directions
                  </Button>
                  <Button
                    onClick={handleShare}
                    className="rounded-2xl bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 font-semibold h-12 gap-2"
                    variant="outline"
                  >
                    <Share2 className="h-5 w-5" />
                    Share
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* ✅ TIMING INFO */}
            {(gym.opening_time || gym.closing_time) && (
              <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-6 pb-3">
                  <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-[#8B5CF6]" />
                    Hours
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <div className="space-y-2">
                    {gym.opening_time && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Opens</span>
                        <span className="font-semibold text-slate-900">{gym.opening_time}</span>
                      </div>
                    )}
                    {gym.closing_time && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Closes</span>
                        <span className="font-semibold text-slate-900">{gym.closing_time}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column: Stats & Join */}
          <div className="space-y-6">
            {/* ✅ LIVE COMMUNITY STATS — real-time via useGymLiveStats */}
            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="p-6 pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-bold text-slate-900">Today's Stats</CardTitle>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-200">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    Live
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6">
                {/* Total Calories */}
                <div className="rounded-2xl bg-linear-to-br from-orange-50 to-orange-50/50 p-4 border border-orange-100">
                  <div className="flex items-center gap-2 mb-1">
                    <Flame className="h-5 w-5 text-orange-500" />
                    <p className="text-xs font-bold uppercase tracking-wide text-orange-700">Total Calories</p>
                  </div>
                  {statsLoading ? (
                    <Skeleton className="h-8 w-24 bg-orange-200/60" />
                  ) : (
                    <p className="text-2xl font-bold text-orange-900 tabular-nums">
                      {stats.todayCalories.toLocaleString()}
                    </p>
                  )}
                </div>

                {/* Active Today */}
                <div className="rounded-2xl bg-linear-to-br from-blue-50 to-blue-50/50 p-4 border border-blue-100">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-5 w-5 text-blue-500" />
                    <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Active Today</p>
                  </div>
                  {statsLoading ? (
                    <Skeleton className="h-8 w-16 bg-blue-200/60" />
                  ) : (
                    <p className="text-2xl font-bold text-blue-900 tabular-nums">{stats.activeToday.toLocaleString()}</p>
                  )}
                  <p className="text-xs text-blue-600 mt-1">members training now</p>
                </div>

                {/* Members Logged In (checked in today) */}
                <div className="rounded-2xl bg-linear-to-br from-purple-50 to-purple-50/50 p-4 border border-purple-100">
                  <div className="flex items-center gap-2 mb-1">
                    <LogIn className="h-5 w-5 text-purple-500" />
                    <p className="text-xs font-bold uppercase tracking-wide text-purple-700">Members Logged In</p>
                  </div>
                  {statsLoading ? (
                    <Skeleton className="h-8 w-16 bg-purple-200/60" />
                  ) : (
                    <p className="text-2xl font-bold text-purple-900 tabular-nums">
                      {stats.membersLoggedIn.toLocaleString()}
                    </p>
                  )}
                  <p className="text-xs text-purple-600 mt-1">checked in today</p>
                </div>
              </CardContent>
            </Card>

            {/* ✅ JOIN BUTTON */}
            {memberId && !isMyGym && (
              <Card className="rounded-3xl border-2 border-[#8B5CF6] bg-gradient-to-br from-[#8B5CF6]/5 to-purple-50 shadow-sm overflow-hidden">
                <CardContent className="p-6">
                  <Button
                    onClick={handleJoinGym}
                    disabled={isJoining}
                    className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-base font-bold text-white shadow-lg hover:shadow-xl transition-all"
                  >
                    {isJoining ? (
                      <>
                        <CircleDashed className="h-5 w-5 animate-spin mr-2" />
                        Joining...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-5 w-5 mr-2" />
                        Join This Gym
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ✅ ALREADY MEMBER BADGE */}
            {isMyGym && (
              <Card className="rounded-3xl border-2 border-emerald-200 bg-emerald-50 shadow-sm overflow-hidden">
                <CardContent className="p-6 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <p className="font-bold text-emerald-900">You're a member!</p>
                  </div>
                  <p className="text-sm text-emerald-700">Your home gym 💜</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* ✅ DESCRIPTION */}
        {videos.length > 0 && (
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm mt-6 overflow-hidden">
            <CardHeader className="p-6 pb-3">
              <CardTitle className="text-lg font-bold text-slate-900">Gym Videos</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {videos.map((videoUrl, index) => (
                  <div key={`${videoUrl}-${index}`} className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-950/90">
                    <video
                      src={videoUrl}
                      controls
                      preload="metadata"
                      className="h-56 w-full cursor-pointer object-cover"
                      onClick={(event) => openVideoFullscreen(event.currentTarget)}
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-xs font-semibold text-white opacity-90 transition group-hover:opacity-100">
                      Tap to watch fullscreen
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {gym.description && (
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm mt-6">
            <CardHeader className="p-6 pb-3">
              <CardTitle className="text-lg font-bold text-slate-900">About</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <p className="text-slate-700 leading-relaxed">{gym.description}</p>
            </CardContent>
          </Card>
        )}

        {/* Legal & compliance footer — public-facing policies for gateway review. */}
        <LegalLinksFooter
          termsUrl={gym.terms_url}
          privacyUrl={gym.privacy_url}
          refundUrl={gym.refund_url}
          className="mt-10 border-t border-slate-200 pt-6"
        />
      </div>
    </div>
  );
}
