import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  X, 
  Star, 
  Navigation2, 
  Phone, 
  Share2, 
  Bookmark, 
  MapPin, 
  Clock, 
  Globe, 
  Flame, 
  CheckCircle2, 
  Loader2, 
  Building2,
  MessageSquare,
  Image as ImageIcon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

interface GymDetailsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  gymId: string | null;
  gym: any; // The gym object from markers/allGyms
  onJoin: (gymId: string) => Promise<void>;
  memberId?: string | null;
}

export function GymDetailsModal({ 
  isOpen, 
  onOpenChange, 
  gymId, 
  gym: initialGym,
  onJoin,
  memberId 
}: GymDetailsModalProps) {
  const [isFetching, setIsFetching] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [reviews, setReviews] = useState<any[]>([]);
  const [gymPlans, setGymPlans] = useState<any[]>([]);
  const [galleryItems, setGalleryItems] = useState<Array<{ url: string; type: "photo" | "video" }>>([]);
  const [liveStats, setLiveStats] = useState<{
    calories: number;
    activeMembers: number;
    rank: number | null;
  }>({ calories: 0, activeMembers: 0, rank: null });
  const [memberCount, setMemberCount] = useState<number>(0);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [isJoining, setIsJoining] = useState(false);
  const [isWritingReview, setIsWritingReview] = useState(false);
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [gym, setGym] = useState<any>(initialGym);

  // Combine logo and gallery photos for a complete real data sync
  const allGymPhotos = useMemo(() => {
    const photos: Array<{ url: string; type: "photo" | "video" }> = [];

    if (gym?.logo_url) {
      photos.push({ url: gym.logo_url, type: "photo" });
    }

    if (Array.isArray(gym?.gym_photos)) {
      gym.gym_photos.forEach((url: string) => {
        if (url && url !== gym.logo_url) photos.push({ url, type: "photo" });
      });
    }

    if (Array.isArray(gym?.gym_videos)) {
      gym.gym_videos.forEach((url: string) => {
        if (url) photos.push({ url, type: "video" });
      });
    }

    galleryItems.forEach((item) => {
      if (!photos.some((existing) => existing.url === item.url)) {
        photos.push(item);
      }
    });

    return photos.length > 0
      ? photos
      : [{ url: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1470&auto=format&fit=crop", type: "photo" }];
  }, [gym?.logo_url, gym?.gym_photos, gym?.gym_videos, galleryItems]);

  const averageRating = useMemo(() => {
    if (reviews.length === 0) return Number(gym?.rating || 0) || 0;
    return reviews.reduce((acc, review) => acc + (Number(review.rating) || 0), 0) / reviews.length;
  }, [reviews, gym?.rating]);

  const crowdLabel = useMemo(() => {
    if (liveStats.activeMembers >= 15) return "Busy";
    if (liveStats.activeMembers >= 7) return "Steady";
    return "Quiet";
  }, [liveStats.activeMembers]);

  const fetchGymDetails = useCallback(async (id: string) => {
    if (!id) return;
    try {
      console.log(`DEBUG: GymDetailsModal - Fetching details for ${id}...`);
      const { data, error } = await supabase
        .from("gym_settings")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      
      if (error) {
        console.error("DEBUG: Error fetching fresh gym details:", error);
        return;
      }

      if (data) {
        console.log(`DEBUG: GymDetailsModal - Successfully fetched details for ${data.gym_name}`);
        setGym((prev: any) => ({
          ...prev,
          ...data
        }));

        const galleryPayload: Array<{ url: string; type: "photo" | "video" }> = [];
        if (Array.isArray(data.gym_photos)) {
          data.gym_photos.forEach((url: string) => {
            if (url) galleryPayload.push({ url, type: "photo" });
          });
        }
        if (Array.isArray(data.gym_videos)) {
          data.gym_videos.forEach((url: string) => {
            if (url) galleryPayload.push({ url, type: "video" });
          });
        }
        setGalleryItems(galleryPayload);

        try {
          const { data: mediaRows, error: mediaError } = await supabase
            .from("gym_media")
            .select("media_url, media_type, url, type, sort_order")
            .eq("gym_id", id)
            .order("sort_order", { ascending: true });

          if (!mediaError && Array.isArray(mediaRows) && mediaRows.length > 0) {
            setGalleryItems((prev) => {
              const merged = [...prev];
              mediaRows.forEach((row: any) => {
                const url = row.media_url || row.url;
                if (!url || merged.some((item) => item.url === url)) return;
                const mediaType = String(row.media_type || row.type || "photo").toLowerCase();
                merged.push({ url, type: mediaType.includes("video") ? "video" : "photo" });
              });
              return merged;
            });
          }
        } catch (mediaErr) {
          console.warn("GymDetailsModal: gym_media fetch skipped", mediaErr);
        }
      } else {
        console.warn(`DEBUG: GymDetailsModal - No gym found with ID ${id}`);
        // If initialGym has data but query returned null (rare mismatch), use initialGym
        if (initialGym) {
          setGym(initialGym);
        }
      }
    } catch (err) {
      console.error("DEBUG: Unexpected error fetching fresh gym details:", err);
    }
  }, [initialGym]);

  const fetchLiveStats = useCallback(async (id: string) => {
    if (!id) return;
    try {
      console.log(`DEBUG: GymDetailsModal - Fetching live stats for ${id}...`);
      // 1. Fetch Rank and Vibe Points from gym_leaderboard view
      const { data: rankData, error: rankError } = await supabase
        .from("gym_leaderboard")
        .select("rank, vibe_points")
        .eq("gym_id", id)
        .maybeSingle();

      if (rankError) {
        console.error("DEBUG: Error fetching rank from view:", rankError);
      }

      // 2. Fetch Active members in last 4 hours
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: memberData, error: memberError } = await supabase
        .from("workout_logs")
        .select("user_id")
        .eq("gym_id", id)
        .gte("created_at", fourHoursAgo);
      
      if (memberError) {
        console.error("DEBUG: Error fetching member activity:", memberError);
      }
      const activeCount = new Set(memberData?.map(m => m.user_id)).size;

      // 3. Calorie aggregation: Combine view data with real-time logs
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      
      const { data: todayLogs } = await supabase
        .from("workout_logs")
        .select("calories_burned")
        .eq("gym_id", id)
        .gte("created_at", startOfDay.toISOString());
      
      const todayTotal = (todayLogs || []).reduce((sum, log) => sum + (Number(log.calories_burned) || 0), 0);
      
      const finalCalories = Math.max(Number(rankData?.vibe_points || 0), todayTotal);

      setLiveStats({ 
        calories: finalCalories, 
        activeMembers: activeCount,
        rank: rankData?.rank || null 
      });
    } catch (err) {
      console.error("DEBUG: Unexpected error fetching live stats:", err);
    }
  }, []);

  const fetchPlans = useCallback(async (id: string) => {
    if (!id) return;

    try {
      const { data: primaryPlans, error: primaryError } = await supabase
        .from("gym_plans")
        .select("id, name, plan_name, price, duration, duration_days, features, gym_id, gym_owner_id")
        .eq("gym_id", id)
        .order("price", { ascending: true });

      if (!primaryError && Array.isArray(primaryPlans) && primaryPlans.length > 0) {
        setGymPlans(primaryPlans);
        return;
      }

      const { data: gymRow } = await supabase
        .from("gym_settings")
        .select("gym_owner_id")
        .eq("id", id)
        .maybeSingle();

      if (gymRow?.gym_owner_id) {
        const { data: ownerPlans } = await supabase
          .from("gym_plans")
          .select("id, name, plan_name, price, duration, duration_days, features, gym_id, gym_owner_id")
          .eq("gym_owner_id", gymRow.gym_owner_id)
          .order("price", { ascending: true });

        setGymPlans(ownerPlans || []);
        return;
      }

      setGymPlans([]);
    } catch (err) {
      console.error("Error fetching plans:", err);
      setGymPlans([]);
    }
  }, []);

  const fetchReviews = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, member_id, gym_id, rating, comment, created_at, profiles(full_name, avatar_url)")
        .eq("gym_id", id)
        .order("created_at", { ascending: false });

      if (error) {
        const { data: fallbackReviews, error: fallbackError } = await supabase
          .from("gym_reviews")
          .select("id, member_id, gym_id, rating, comment, created_at, profiles(full_name, avatar_url)")
          .eq("gym_id", id)
          .order("created_at", { ascending: false });

        if (fallbackError) throw fallbackError;
        setReviews(fallbackReviews || []);
        return;
      }

      setReviews(data || []);
    } catch (err) {
      console.error("Error fetching reviews:", err);
    }
  }, []);

  const fetchPlansAndReviews = useCallback(async (id: string) => {
    await Promise.all([fetchPlans(id), fetchReviews(id)]);
  }, [fetchPlans, fetchReviews]);

  const fetchMemberCount = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const { count, error } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("gym_id", id);

      if (error) throw error;
      setMemberCount(count || 0);
    } catch (err) {
      console.error("Error fetching member count:", err);
    }
  }, []);

  const handleDirections = () => {
    if (!gym?.latitude || !gym?.longitude) {
      toast.info("Gym location not set by owner");
      return;
    }

    const url = `https://www.google.com/maps/dir/?api=1&destination=${gym.latitude},${gym.longitude}`;
    window.open(url, "_blank");
  };

  const handleCall = () => {
    if (!gym?.phone) {
      toast.info("Phone number not available");
      return;
    }
    window.location.href = `tel:${gym.phone}`;
  };

  const handleShare = async () => {
    if (!gym) return;
    const shareData = {
      title: gym.gym_name,
      text: `Check out ${gym.gym_name} on Gymphony!`,
      url: window.location.href
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Link copied to clipboard!");
      }
    } catch (err) {
      console.error("Error sharing:", err);
    }
  };

  const handleSave = () => {
    toast.success("Gym saved to your favorites!");
  };

  const handleSubmitReview = async () => {
    if (!gymId) return;
    if (!memberId) {
      toast.error("Please sign in to post a review");
      return;
    }
    if (!newComment.trim()) {
      toast.error("Please add a comment");
      return;
    }

    try {
      setIsSubmittingReview(true);
      const { error } = await supabase
        .from("reviews")
        .insert({
          member_id: memberId,
          gym_id: gymId,
          rating: newRating,
          comment: newComment.trim(),
        });

      if (error) throw error;

      setNewRating(5);
      setNewComment("");
      setIsWritingReview(false);
      toast.success("Review posted");
      await fetchReviews(gymId);
    } catch (err) {
      console.error("Error submitting review:", err);
      toast.error("Could not post your review");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleJoinAction = async () => {
    if (!gymId) return;
    setIsJoining(true);
    try {
      await onJoin(gymId);
      // Fresh details after joining
      await fetchGymDetails(gymId);
    } catch (err) {
      console.error("Error joining gym:", err);
    } finally {
      setIsJoining(false);
    }
  };

  useEffect(() => {
    if (isOpen && gymId) {
      console.log('GymDetailsModal triggered for ID:', gymId);
      setIsFetching(true);
      
      Promise.all([
        fetchGymDetails(gymId),
        fetchLiveStats(gymId),
        fetchPlansAndReviews(gymId),
        fetchMemberCount(gymId)
      ]).finally(() => setIsFetching(false));

      // Real-time setup
      const channelId = Math.random().toString(36).substring(7);
      const workoutChannel = supabase
        .channel(`gym-live-vibe-${gymId}-${channelId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "workout_logs", filter: `gym_id=eq.${gymId}` },
          () => {
            console.log(`DEBUG: Live stats update for ${gymId}`);
            void fetchLiveStats(gymId);
          }
        )
        .subscribe();

      const gymSettingsChannel = supabase
        .channel(`gym-settings-modal-${gymId}-${channelId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "gym_settings", filter: `id=eq.${gymId}` }, () => fetchGymDetails(gymId))
        .subscribe();

      return () => {
        supabase.removeChannel(workoutChannel);
        supabase.removeChannel(gymSettingsChannel);
      };
    }
  }, [isOpen, gymId, fetchGymDetails, fetchLiveStats, fetchPlansAndReviews, fetchMemberCount]);

  useEffect(() => {
    if (initialGym && !gym) {
      setGym(initialGym);
    }
  }, [initialGym]);

  // Design Restoration: Google Maps style Slide-up Panel Logic
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-120 p-0 overflow-hidden border-none bg-white shadow-2xl flex flex-col z-9999 font-sans ${
        isMobile 
          ? "h-[85vh] rounded-t-[3rem] bottom-0 top-auto translate-y-0" 
          : "h-[92vh] rounded-[2.5rem] top-1/2 -translate-y-1/2"
      }`}>
        <AnimatePresence mode="wait">
          {isFetching && !gym ? (
            <div className="flex flex-col h-full bg-white p-8 space-y-6">
              <Skeleton className="h-56 w-full rounded-[2rem]" />
              <div className="space-y-2">
                <Skeleton className="h-8 w-3/4 rounded-lg" />
                <Skeleton className="h-4 w-1/2 rounded-lg" />
              </div>
              <div className="flex justify-between py-6">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-14 rounded-full" />)}
              </div>
              <Skeleton className="h-40 w-full rounded-[2rem]" />
            </div>
          ) : gym ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col h-full overflow-hidden bg-white"
            >
              {/* Google Maps Style Header Handle (Mobile) */}
              {isMobile && (
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mt-4 mb-2 shrink-0" />
              )}

              {/* Top Section: Badi cover photo */}
              <div className="relative h-56 w-full shrink-0 group">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentPhotoIndex}
                    src={allGymPhotos[currentPhotoIndex]?.url}
                    className="h-full w-full object-cover"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  />
                </AnimatePresence>
                
                <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-80" />
                
                <button 
                  onClick={() => onOpenChange(false)}
                  className="absolute top-5 right-5 z-50 p-2.5 bg-black/30 backdrop-blur-md rounded-full text-white hover:bg-black/50 transition-all border border-white/20 shadow-lg"
                >
                  <X className="h-5 w-5" />
                </button>
                
                <div className="absolute bottom-5 left-6 right-6 flex justify-between items-center">
                   <div className="bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full text-white text-[11px] font-bold border border-white/20 shadow-md">
                     {allGymPhotos.length} Photos
                   </div>
                   {allGymPhotos.length > 1 && (
                     <div className="flex gap-2">
                       <button 
                         onClick={() => setCurrentPhotoIndex(prev => (prev > 0 ? prev - 1 : allGymPhotos.length - 1))}
                         className="p-1.5 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/40 transition-all border border-white/20"
                       >
                         <ImageIcon className="h-4 w-4" />
                       </button>
                       <button 
                         onClick={() => setCurrentPhotoIndex(prev => (prev < allGymPhotos.length - 1 ? prev + 1 : 0))}
                         className="p-1.5 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/40 transition-all border border-white/20"
                       >
                         <ImageIcon className="h-4 w-4 scale-x-[-1]" />
                       </button>
                     </div>
                   )}
                </div>
              </div>

              {/* Title Area */}
              <div className="px-8 pt-6 pb-4 shrink-0 bg-white">
                <div className="flex justify-between items-start mb-2">
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">{gym.gym_name}</h2>
                  <Badge className="bg-primary/10 text-primary border-none text-[10px] font-black tracking-widest uppercase">
                    {liveStats.rank ? `Rank #${liveStats.rank}` : 'Top Rated'}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2 mb-6">
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 rounded-lg">
                    <span className="text-amber-600 font-black text-sm">
                      {averageRating ? averageRating.toFixed(1) : "0.0"}
                    </span>
                    <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                  </div>
                  <div className="flex text-amber-400">
                    {Array.from({ length: 5 }).map((_, i) => {
                      return (
                        <Star 
                          key={i} 
                          className={`h-3.5 w-3.5 ${i < Math.round(averageRating || 0) ? 'fill-current' : 'text-current opacity-30'}`} 
                        />
                      );
                    })}
                  </div>
                  <span className="text-slate-400 text-sm font-bold tracking-tight">({reviews.length} Reviews)</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {crowdLabel}
                  </span>
                </div>

                {/* Google Maps Style Action Row */}
                <div className="flex justify-between items-center py-4 px-2 border-y border-slate-50">
                   {[
                     { icon: Navigation2, label: "Directions", color: "bg-blue-600 text-white", action: handleDirections },
                     { icon: Phone, label: "Call", color: "bg-emerald-500 text-white", action: handleCall },
                     { icon: Share2, label: "Share", color: "bg-slate-100 text-slate-600", action: handleShare },
                     { icon: Bookmark, label: "Save", color: "bg-slate-100 text-slate-600", action: handleSave }
                   ].map((item, i) => (
                     <div key={i} className="flex flex-col items-center gap-2 cursor-pointer group" onClick={item.action}>
                       <div className={`h-12 w-12 rounded-full flex items-center justify-center transition-all group-hover:scale-110 group-active:scale-95 shadow-sm ${item.color}`}>
                         <item.icon className="h-5 w-5" />
                       </div>
                       <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{item.label}</span>
                     </div>
                   ))}
                </div>
              </div>

              {/* Tabs Section */}
              <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden bg-white" onValueChange={setActiveTab}>
                <TabsList className="w-full justify-start h-14 bg-white border-b border-slate-50 px-8 gap-8 rounded-none">
                  <TabsTrigger 
                    value="overview" 
                    className="h-full rounded-none border-b-4 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary font-black text-xs uppercase tracking-widest px-0"
                  >
                    Overview
                  </TabsTrigger>
                  <TabsTrigger 
                    value="reviews" 
                    className="h-full rounded-none border-b-4 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary font-black text-xs uppercase tracking-widest px-0"
                  >
                    Reviews
                  </TabsTrigger>
                  <TabsTrigger 
                    value="photos" 
                    className="h-full rounded-none border-b-4 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary font-black text-xs uppercase tracking-widest px-0"
                  >
                    Photos
                  </TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                  <TabsContent value="overview" className="p-8 space-y-8 mt-0 bg-white">
                    {/* Real-time Stats Card */}
                    <div className="p-6 rounded-[2rem] bg-slate-900 text-white shadow-2xl relative overflow-hidden">
                       <div className="absolute top-0 right-0 p-8 opacity-10">
                          <Flame className="h-20 w-20" />
                       </div>
                       <div className="grid grid-cols-2 gap-4 relative z-10">
                         <div className="border-r border-white/10 pr-4">
                            <p className="text-white/50 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Live Burn</p>
                            <div className="flex items-baseline gap-1">
                              <span className="text-3xl font-black tracking-tighter">
                                {Math.round(liveStats.calories).toLocaleString()}
                              </span>
                              <span className="text-[10px] font-bold opacity-50">cal</span>
                            </div>
                         </div>
                         <div className="pl-4">
                            <p className="text-white/50 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Active Now</p>
                            <div className="flex items-baseline gap-1">
                              <span className="text-3xl font-black tracking-tighter">{liveStats.activeMembers}</span>
                              <span className="text-[10px] font-bold opacity-50">/ {memberCount}</span>
                            </div>
                         </div>
                       </div>
                    </div>

                    {gymPlans.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">Active Plans</h4>
                          <span className="text-[10px] font-bold text-slate-400">Live from gym_plans</span>
                        </div>
                        <div className="space-y-2">
                          {gymPlans.slice(0, 3).map((plan) => (
                            <div key={plan.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 flex items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-bold text-slate-900">{plan.plan_name || plan.name}</p>
                                <p className="text-xs text-slate-500 mt-1">{Number(plan.price || 0).toLocaleString()} • {plan.duration_days || plan.duration || 30} days</p>
                              </div>
                              <Badge variant="outline" className="rounded-full border-slate-200 text-slate-500 font-bold">
                                Plan
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Details List */}
                    <div className="space-y-6">
                      <div className="flex items-start gap-5 group cursor-pointer" onClick={handleDirections}>
                        <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                          <MapPin className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 pt-1">
                          <p className="text-sm font-bold text-slate-800 leading-tight">
                            {gym.address || gym.city || "Aligarh, Uttar Pradesh"}
                          </p>
                          <p className="text-[10px] text-blue-600 font-black mt-1 uppercase tracking-widest">Directions</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-5">
                        <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
                          <Clock className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 pt-1">
                          <p className="text-sm font-bold text-slate-800">
                            {gym.opening_time || "06:00 AM"} - {gym.closing_time || "10:00 PM"}
                          </p>
                          <p className="text-[10px] text-emerald-600 font-black mt-1 uppercase tracking-widest">Open Now</p>
                        </div>
                      </div>

                      {gym.website && (
                        <div className="flex items-start gap-5 group cursor-pointer" onClick={() => window.open(gym.website.startsWith('http') ? gym.website : `https://${gym.website}`, '_blank')}>
                          <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                            <Globe className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 pt-1">
                            <p className="text-sm font-bold text-blue-600 truncate">{gym.website}</p>
                            <p className="text-[10px] text-slate-400 font-black mt-1 uppercase tracking-widest">Website</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Join Action Area */}
                    <div className="pt-4">
                      {gym.is_enrolled ? (
                        <Button disabled className="w-full h-16 rounded-[1.5rem] bg-emerald-50 text-emerald-600 border border-emerald-100 font-black text-lg gap-3">
                          <CheckCircle2 className="h-7 w-7" />
                          ENROLLED
                        </Button>
                      ) : (
                        <Button 
                          onClick={handleJoinAction}
                          disabled={isJoining}
                          className="w-full h-16 rounded-[1.5rem] bg-primary text-white hover:bg-primary/90 font-black text-lg shadow-xl shadow-primary/30 transition-all gap-3"
                        >
                          {isJoining ? <Loader2 className="h-7 w-7 animate-spin" /> : <Building2 className="h-7 w-7" />}
                          JOIN THIS GYM
                        </Button>
                      )}
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="reviews" className="p-8 mt-0 bg-white">
                    {/* Reviews content same as before but styled cleaner */}
                    {/* ... (rest of the content simplified for readability) ... */}
                    <div className="space-y-6">
                      <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-5 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">Post Review</p>
                            <p className="text-sm text-slate-500 mt-1">Share your experience with this gym.</p>
                          </div>
                          {!memberId && <Badge variant="outline" className="rounded-full border-slate-200 text-slate-500 font-bold">Login required</Badge>}
                        </div>

                        <div className="flex items-center gap-2">
                          {Array.from({ length: 5 }).map((_, index) => {
                            const starValue = index + 1;
                            return (
                              <button
                                key={starValue}
                                type="button"
                                onClick={() => setNewRating(starValue)}
                                className="transition-transform hover:scale-110"
                              >
                                <Star className={`h-5 w-5 ${starValue <= newRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                              </button>
                            );
                          })}
                          <span className="text-xs font-bold text-slate-500 ml-1">{newRating}/5</span>
                        </div>

                        <Textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Tell others what this gym feels like..."
                          className="min-h-28 rounded-2xl border-slate-200 bg-white"
                        />

                        <div className="flex items-center justify-between gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsWritingReview(false)}
                            className="rounded-2xl border-slate-200 text-slate-600 font-bold"
                          >
                            Clear
                          </Button>
                          <Button
                            type="button"
                            onClick={handleSubmitReview}
                            disabled={isSubmittingReview || !memberId}
                            className="rounded-2xl bg-primary text-white font-black shadow-lg shadow-primary/20"
                          >
                            {isSubmittingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post Review"}
                          </Button>
                        </div>
                      </div>

                      {reviews.length === 0 ? (
                        <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-6 text-center">
                          <MessageSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm font-bold text-slate-700">No reviews yet</p>
                          <p className="text-xs text-slate-500 mt-1">Be the first member to share feedback for this gym.</p>
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {reviews.map((review) => (
                            <div key={review.id} className="space-y-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <div className="h-9 w-9 rounded-full bg-slate-100 overflow-hidden">
                                    {review.profiles?.avatar_url ? <img src={review.profiles.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{review.profiles?.full_name?.[0]}</div>}
                                  </div>
                                  <div>
                                    <p className="text-sm font-bold text-slate-900">{review.profiles?.full_name || "Member"}</p>
                                    <p className="text-[10px] text-slate-400">{new Date(review.created_at).toLocaleDateString()}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-amber-400">
                                  {Array.from({ length: 5 }).map((_, index) => (
                                    <Star key={index} className={`h-3.5 w-3.5 ${index < Number(review.rating || 0) ? 'fill-current' : 'opacity-30'}`} />
                                  ))}
                                </div>
                              </div>
                              <p className="text-sm text-slate-600 leading-relaxed">{review.comment}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="photos" className="p-8 mt-0 bg-white">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">Gallery</p>
                          <p className="text-sm text-slate-500 mt-1">Photos and media from this gym.</p>
                        </div>
                        <Badge variant="outline" className="rounded-full border-slate-200 text-slate-500 font-bold">
                          {allGymPhotos.length} items
                        </Badge>
                      </div>

                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {allGymPhotos.map((item, index) => (
                          <div key={`${item.url}-${index}`} className="relative h-44 w-64 flex-none overflow-hidden rounded-[1.75rem] border border-slate-100 bg-slate-50 shadow-sm">
                            {item.type === "video" ? (
                              <video src={item.url} className="h-full w-full object-cover" controls />
                            ) : (
                              <img src={item.url} alt={`${gym.gym_name} gallery ${index + 1}`} className="h-full w-full object-cover" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-12 text-center bg-white min-h-112.5">
              <div className="h-20 w-20 bg-red-50 rounded-[2rem] flex items-center justify-center mb-6">
                <Building2 className="h-10 w-10 text-red-400" />
              </div>
              <h3 className="text-slate-900 font-black text-xl mb-2 tracking-tight">Gym Not Found</h3>
              <p className="text-slate-500 text-sm leading-relaxed max-w-60">
                Record ID: <span className="font-mono text-[10px] bg-slate-50 px-1.5 py-0.5 rounded">{gymId}</span>
              </p>
              <Button 
                variant="outline" 
                className="mt-8 rounded-xl border-slate-200 px-8 h-12 font-black text-slate-600"
                onClick={() => onOpenChange(false)}
              >
                Back to Map
              </Button>
            </div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
