import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence, useSpring, useTransform, useMotionValue, animate } from "framer-motion";

function AnimatedNumber({ value }: { value: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest).toLocaleString());

  useEffect(() => {
    const controls = animate(count, value, { duration: 2, ease: "easeOut" });
    return controls.stop;
  }, [value, count]);

  return <motion.span>{rounded}</motion.span>;
}

import {
  CalendarCheck2, CheckCircle2, CircleDashed, Dumbbell, Flame, LogOut, LayoutDashboard,
  Sparkles, Trophy, QrCode, Loader2, Zap, Search, Map as MapIcon, MapPin, Activity,
  CreditCard, Package, ShoppingBag, ChevronRight, TrendingUp, Clock, User, Settings, Bell, Building2,
  Star, Phone, ArrowUpRight, Camera, X, Scan, Maximize2, ShieldCheck
} from "lucide-react";
import { toast } from "sonner";
import { Html5QrcodeScanner } from "html5-qrcode";
import { QRCodeCanvas } from "qrcode.react";

import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { MemberQRCard } from "@/components/MemberQRCard";
import { MemberActivePlans } from "@/components/MemberActivePlans";
import { MemberAIChat } from "@/components/MemberAIChat";
import { MemberWallCheckIn } from "@/components/MemberWallCheckIn";
import { MemberPurchaseHistory } from "@/components/MemberPurchaseHistory";
import { ProfileSettings } from "@/components/ProfileSettings";
import { CityLeaderboard } from "@/components/CityLeaderboard";
import { CityGymExplorer } from "@/components/CityGymExplorer";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { isValidInternationalPhone, normalizeToE164Phone } from "@/lib/phone";
import { useRealtimeLeaderboard } from "@/hooks/useRealtimeLeaderboard";
import { MemberUpiCheckout } from "@/components/MemberUpiCheckout";
import { LegalLinksFooter } from "@/components/LegalLinksFooter";
import { MemberAttendanceTab } from "@/components/MemberAttendanceTab";
import { MemberGymStore } from "@/components/MemberGymStore";
import { MemberNotesTab } from "@/components/MemberNotesTab";
import { MemberGoalsCard } from "@/components/MemberGoalsCard";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface GymSearchResult {
  id: string; gym_name: string; logo_url?: string; city?: string; address?: string; gym_owner_id?: string;
}

interface InventoryItem {
  id: string; item_name: string; category?: string; price: number; stock_quantity: number; image_url?: string;
}

interface Member {
  id: string; email: string; full_name?: string; gym_id?: string; membership_plan?: string; short_id?: string;
  subscription_status?: string; status?: string; phone?: string; whatsapp_number?: string; mobile_number?: string;
  avatar_url?: string; subscription_end_date?: string; joined_at?: string;
}

interface GymInfo {
  id: string; gym_name: string; opening_time?: string; city?: string; address?: string; gym_owner_id?: string;
  latitude?: number | null; longitude?: number | null; upi_id?: string | null;
  terms_url?: string | null; privacy_url?: string | null; refund_url?: string | null;
}

interface GymPlan {
  id: string; plan_name: string; price: number; duration_days: number; features?: string[]; gym_owner_id?: string | null;
}

interface Notification {
  id: string; activity_type: string; description: string; is_read: boolean; created_at: string;
}

const activityOptions = ["Running", "Weightlifting", "Cycling", "HIIT", "HIIT-Box", "Swimming", "Yoga", "Walking"];

const metValues: Record<string, number> = {
  Running: 9.0, Weightlifting: 5.5, Cycling: 7.5, HIIT: 9.0, "HIIT-Box": 9.5, Swimming: 7.5, Yoga: 3.5, Walking: 3.5,
};

const estimateCalories = (activityType: string, durationMinutes: number) => {
  const met = metValues[activityType] || 3.0;
  const weightKg = 70;
  const calories = (met * 3.5 * weightKg / 200) * durationMinutes;
  return Math.max(0, Math.round(calories));
};

export default function MemberDashboard() {
  const navigate = useNavigate();
  const [member, setMember] = useState<Member | null>(null);
  const [gymInfo, setGymInfo] = useState<GymInfo | null>(null);
  const [gymPlans, setGymPlans] = useState<GymPlan[]>([]);
  const [gymStats, setGymStats] = useState<{ rank: number; totalCalories: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [todayCalories, setTodayCalories] = useState(0);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [totalGymCalories, setTotalGymCalories] = useState(0);
  const [nextSession, setNextSession] = useState("06:30 PM");
  const [selectedActivity, setSelectedActivity] = useState(activityOptions[0]);
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GymSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<GymPlan | null>(null);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [showMobilePrompt, setShowMobilePrompt] = useState(false);
  const [isUpdatingMobile, setIsUpdatingMobile] = useState(false);
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  const calculateNextSession = useCallback((gymOpeningTime?: string) => {
    if (gymOpeningTime) {
      setNextSession(gymOpeningTime);
      return;
    }
    setNextSession("06:30 PM");
  }, []);

  const fetchTotalGymCalories = useCallback(async (gymId: string) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfDay);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    try {
      const { data, error } = await supabase
        .from("workout_logs")
        .select("calories_burned")
        .eq("gym_id", gymId)
        .gte("created_at", startOfDay.toISOString())
        .lt("created_at", startOfTomorrow.toISOString());

      if (error) throw error;
      const total = (data || []).reduce((sum, log) => sum + (Number(log.calories_burned) || 0), 0);
      setTotalGymCalories(total);
    } catch (err) {
      console.error("Error fetching gym total calories:", err);
    }
  }, []);

  const fetchNotifications = useCallback(async (memberId: string) => {
    try {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setNotifications(data || []);
      setUnreadNotifications((data || []).filter(n => !n.is_read).length);
    } catch (err) {
      console.error("Notifications fetch error:", err);
    }
  }, []);

  const markNotificationsAsRead = async () => {
    if (!member?.id) return;
    try {
      await supabase
        .from("activity_log")
        .update({ is_read: true })
        .eq("member_id", member.id)
        .eq("is_read", false);
      setUnreadNotifications(0);
    } catch (err) {
      console.error("Mark as read error:", err);
    }
  };

  const [showQRScanner, setShowQRScanner] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSavingGymId, setIsSavingGymId] = useState(false);
  const qrScannerRef = useRef<Html5QrcodeScanner | null>(null);

  const CITY = "ALIGARH";
  const { leaderboard, isLoading: leaderboardLoading } = useRealtimeLeaderboard(CITY, true);

  useEffect(() => {
    if (member?.full_name) {
      setFullName(member.full_name);
    } else if (member?.email) {
      setFullName(member.email.split('@')[0]);
    }
  }, [member]);

  const handleSaveMobile = async () => {
    if (!member?.id || !mobileNumber.trim()) {
      toast.error("Please enter a valid mobile number");
      return;
    }
    const cleanMobile = normalizeToE164Phone(mobileNumber, "+91");
    if (!cleanMobile || !isValidInternationalPhone(cleanMobile)) {
      toast.error("Invalid mobile number format");
      return;
    }
    setIsUpdatingMobile(true);
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ phone: cleanMobile, mobile_number: cleanMobile, full_name: member.full_name || "Member" })
        .eq('id', member.id);

      if (profileError) {
        const { error: legacyError } = await supabase
          .from("profiles")
          .update({ whatsapp_number: cleanMobile, mobile_number: cleanMobile, phone: cleanMobile })
          .eq('id', member.id);
        if (legacyError) throw legacyError;
      }

      const updatedMember = { ...member, phone: cleanMobile, whatsapp_number: cleanMobile, mobile_number: cleanMobile };
      setMember(updatedMember);
      setMobileNumber(cleanMobile);
      localStorage.setItem(`mobile_prompt_dismissed_${member.id}`, "true");
      toast.success("Mobile number saved successfully!");

      setTimeout(() => {
        setShowMobilePrompt(false);
        refreshGymContext(member.gym_id || "", member.id);
      }, 800);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message || "Unknown database error"}`);
    } finally {
      setIsUpdatingMobile(false);
    }
  };

  const handleSkipMobile = () => {
    if (member?.id) {
      localStorage.setItem(`mobile_prompt_dismissed_${member.id}`, "true");
    }
    setShowMobilePrompt(false);
  };

  const handleUpdateName = async () => {
    if (!member?.id || fullName === member.full_name) return;
    if (!fullName.trim()) {
      toast.error("Name cannot be empty");
      setFullName(member.full_name || member.email.split('@')[0]);
      return;
    }
    setIsUpdatingName(true);
    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: member.id, full_name: fullName.trim() }, { onConflict: 'id' });
      if (profileError) throw profileError;

      const { error: memberError } = await supabase
        .from('members')
        .upsert({ id: member.id, full_name: fullName.trim(), email: member.email }, { onConflict: 'id' });
      if (memberError) throw memberError;

      toast.success("Profile Updated!", { description: "Your name has been updated successfully.", duration: 3000 });
      setMember((prev) => prev ? ({ ...prev, full_name: fullName.trim() }) : null);
    } catch (err) {
      toast.error("Failed to update name.");
    } finally {
      setIsUpdatingName(false);
    }
  };

  const firstName = useMemo(() => member?.full_name?.split(" ")?.[0] ?? "Member", [member]);
  const membershipName = member?.membership_plan || "Active Member";

  // ✅ PERFECT RANK LOGIC: Sorts safely and finds correct position
  const gymRank = useMemo(() => {
    if (!member?.gym_id || !leaderboard.length) return null;
    const sortedLeaderboard = [...leaderboard].sort((a, b) => (b.vibe_points ?? 0) - (a.vibe_points ?? 0));
    const index = sortedLeaderboard.findIndex(e => e.gym_id === member.gym_id || e.gym_owner_id === member.gym_id);
    return index !== -1 ? index + 1 : null;
  }, [member?.gym_id, leaderboard]);

  const fetchInventory = useCallback(async (gymId: string) => {
    try {
      const { data, error } = await supabase.from("inventory").select("*").eq("gym_id", gymId).gt("stock_quantity", 0);
      if (error) { setInventory([]); return; }
      setInventory(data || []);
    } catch (err) { setInventory([]); }
  }, []);

  const fetchTodayCalories = useCallback(async (memberId: string) => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfDay); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    try {
      const { data, error } = await supabase.from("workout_logs").select("calories_burned")
        .or(`user_id.eq.${memberId},member_id.eq.${memberId}`)
        .gte("created_at", startOfDay.toISOString()).lt("created_at", startOfTomorrow.toISOString());
      if (error) return;
      const totalCalories = (data || []).reduce((sum, log) => sum + (Number(log.calories_burned) || 0), 0);
      setTodayCalories(totalCalories);
    } catch (err) { console.error("Error in fetchTodayCalories:", err); }
  }, []);

  // Has this member already recorded attendance today? (Wall QR or owner kiosk.)
  const fetchTodayCheckin = useCallback(async (memberId: string) => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    try {
      const { data, error } = await supabase.from("check_ins").select("id")
        .eq("member_id", memberId)
        .gte("check_in_time", startOfDay.toISOString())
        .limit(1);
      if (error) return;
      setCheckedInToday((data || []).length > 0);
    } catch (err) { console.error("Error in fetchTodayCheckin:", err); }
  }, []);

  const fetchGymPlans = useCallback(async (gymId: string) => {
    try {
      const { data: plansData, error: plansError } = await supabase.from("gym_plans").select("*").eq("gym_id", gymId);
      if (!plansError && plansData && plansData.length > 0) {
        const normalizedPlans = plansData.map(p => ({
          id: p.id, plan_name: p.name || p.plan_name, price: p.price,
          duration_days: (p.duration * 30) || p.duration_days || 30,
          features: p.features || ["Full Gym Access", "Expert Guidance", "Free WiFi"]
        }));
        setGymPlans(normalizedPlans);
      } else { setGymPlans([]); }
    } catch (err) { setGymPlans([]); }
  }, []);

  const fetchGymStats = useCallback(async (gymId: string) => {
    // Redundant now because gymRank uses the live array, but kept for safe fallback.
    if (!gymId) return;
    try {
      const { data } = await supabase.from("gym_leaderboard").select("rank, vibe_points").eq("gym_id", gymId).maybeSingle();
      if (data) setGymStats({ rank: data.rank || 0, totalCalories: data.vibe_points || 0 });
    } catch (err) {}
  }, []);

  const resolveGymInfo = useCallback(async (gymId: string) => {
    const settingsCols = "id, gym_name, opening_time, city, address, gym_owner_id, latitude, longitude, upi_id, terms_url, privacy_url, refund_url";
    const { data: gymById } = await supabase.from("gym_settings").select(settingsCols).eq("id", gymId).maybeSingle();
    if (gymById) return gymById;
    const { data: gymByOwner } = await supabase.from("gym_settings").select(settingsCols).eq("gym_owner_id", gymId).maybeSingle();
    if (gymByOwner) return gymByOwner;
    const { data: profileData } = await supabase.from("gym_profiles").select("id, gym_name, opening_time, city, address, latitude, longitude").eq("id", gymId).maybeSingle();
    return profileData ?? null;
  }, []);

  const refreshGymContext = useCallback(async (gymId: string, memberId: string) => {
    const gymData = await resolveGymInfo(gymId);
    setGymInfo(gymData);
    calculateNextSession(gymData?.opening_time);
    await Promise.all([
      fetchGymStats(gymId), fetchGymPlans(gymId), fetchTodayCalories(memberId),
      fetchTotalGymCalories(gymId), fetchInventory(gymId),
    ]);
  }, [fetchGymPlans, fetchGymStats, fetchTodayCalories, fetchTotalGymCalories, fetchInventory, resolveGymInfo, calculateNextSession]);

  useEffect(() => {
    const loadMember = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate({ to: "/login" });
          return;
        }

        const { data: profileData } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
        const { data: memberData } = await supabase.from("members").select("*").eq("id", user.id).maybeSingle();

        const resolvedGymId = profileData?.gym_id || memberData?.gym_id || null;
        const resolvedMobile = profileData?.phone || profileData?.mobile_number || profileData?.whatsapp_number || memberData?.phone || "";

        const mergedMember: Member = {
          id: user.id, email: profileData?.email || user.email || "", full_name: profileData?.full_name || memberData?.member_name || "Member",
          gym_id: resolvedGymId, short_id: profileData?.short_id || null, membership_plan: profileData?.membership_plan || memberData?.membership_plan || "Active Member",
          subscription_status: profileData?.status || profileData?.subscription_status || "Inactive", status: profileData?.status || "Inactive",
          whatsapp_number: profileData?.whatsapp_number, mobile_number: resolvedMobile, avatar_url: profileData?.avatar_url, subscription_end_date: profileData?.subscription_end_date
        };

        setMember(mergedMember);
        setFullName(mergedMember.full_name || "");
        setMobileNumber(resolvedMobile);

        const hasDismissed = localStorage.getItem(`mobile_prompt_dismissed_${user.id}`);
        if (!mergedMember.whatsapp_number && !mergedMember.mobile_number && !hasDismissed) {
          setShowMobilePrompt(true);
        }

        await Promise.all([fetchTodayCalories(user.id), fetchNotifications(user.id), fetchTodayCheckin(user.id)]);
        if (resolvedGymId) await refreshGymContext(resolvedGymId, user.id);
      } catch (error) {
        console.error("Dashboard loading error:", error);
        toast.error("Could not load dashboard data");
      } finally {
        setIsLoading(false);
      }
    };
    loadMember();
  }, []);

  useEffect(() => {
    const searchGyms = async () => {
      const searchTerm = searchQuery.trim();
      if (!searchTerm) { setSearchResults([]); return; }
      setIsSearching(true);
      try {
        const { data, error } = await supabase.from("gym_settings").select("id, gym_name, logo_url, city, address, gym_owner_id").or(`gym_name.ilike.%${searchTerm}%,city.ilike.%${searchTerm}%`).limit(5);
        if (error) throw error;
        setSearchResults(data || []);
      } catch (err) { setSearchResults([]); } finally { setIsSearching(false); }
    };
    const debounce = setTimeout(searchGyms, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  useEffect(() => {
    if (!member?.id) return;
    const memberId = member.id;
    const gymId = member.gym_id?.trim();
    const channelId = Math.random().toString(36).substring(7);

    const channel = supabase.channel(`member-dashboard-${memberId}-${channelId}`);

    const refreshWorkouts = () => {
      fetchTodayCalories(memberId);
      if (gymId) fetchTotalGymCalories(gymId);
    };

    // Workout logs may be keyed by user_id (current insert) or member_id (legacy) — watch both.
    channel.on("postgres_changes", { event: "*", schema: "public", table: "workout_logs", filter: `user_id=eq.${memberId}` }, refreshWorkouts);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "workout_logs", filter: `member_id=eq.${memberId}` }, refreshWorkouts);

    // Notifications / activity feed update live.
    channel.on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `member_id=eq.${memberId}` }, () => fetchNotifications(memberId));

    // Wall QR / kiosk attendance — instantly flip "checked in today" without a refresh.
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "check_ins", filter: `member_id=eq.${memberId}` }, () => {
      setCheckedInToday(true);
      fetchTodayCheckin(memberId);
    });

    // Owner edits to the gym (name, location, hours) reflect live for the member.
    if (gymInfo?.id) {
      channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "gym_settings", filter: `id=eq.${gymInfo.id}` }, (payload) => {
        setGymInfo((prev) => prev ? { ...prev, ...(payload.new as Partial<GymInfo>) } : (payload.new as GymInfo));
      });
    }

    channel.subscribe((status) => { if (status === "SUBSCRIBED") setIsRealtimeConnected(true); });
    return () => { supabase.removeChannel(channel); };
  }, [member?.id, member?.gym_id, gymInfo?.id, fetchTodayCalories, fetchTotalGymCalories, fetchNotifications, fetchTodayCheckin]);

  const handleFinishSession = async () => {
    const { data: profile } = await supabase.from("profiles").select("gym_id").eq("id", member?.id).maybeSingle();
    const currentGymId = profile?.gym_id || member?.gym_id;

    if (!member?.id || !currentGymId) {
      toast.error("Join a gym to log activities!");
      return;
    }

    const parsedDuration = Number(durationMinutes);
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      toast.error("Please enter a valid duration");
      return;
    }

    const caloriesEarned = estimateCalories(selectedActivity, parsedDuration);

    try {
      // 1. Insert Workout Log
      const { error } = await supabase.from("workout_logs").insert([{
        user_id: member.id,
        gym_id: currentGymId,
        activity_type: selectedActivity,
        duration_minutes: parsedDuration,
        calories_burned: caloriesEarned,
        created_at: new Date().toISOString(),
      }]);

      if (error) throw error;

      // 2. ✅ REAL-TIME POINTS UPDATE (Updating Gym Profiles)
      const { data: gymProfile } = await supabase
        .from("gym_profiles")
        .select("vibe_points")
        .eq("id", currentGymId)
        .maybeSingle();

      const currentPoints = gymProfile?.vibe_points || 0;
      const newPoints = currentPoints + caloriesEarned;

      await supabase
        .from("gym_profiles")
        .update({ vibe_points: newPoints })
        .eq("id", currentGymId);

      setShowSuccessAnimation(true);

      await Promise.all([
        fetchTodayCalories(member.id),
        fetchGymStats(currentGymId),
        fetchTotalGymCalories(currentGymId)
      ]);

      toast.success("Workout Logged! 🦾", {
        description: `Session logged! +${caloriesEarned} cal. Your leaderboard score has been updated.`
      });

      setDurationMinutes("30");
      setTimeout(() => setShowSuccessAnimation(false), 3000);

    } catch (err: any) {
      toast.error("Could not save session", { description: err.message || "Try again." });
    }
  };

  // Zero-fee UPI flow: open the UPI checkout for the chosen plan. The member
  // pays the owner directly and submits for manual verification — activation
  // happens when the owner approves the pending payment.
  const handleBuyPlan = (plan: GymPlan) => {
    if (!member?.id || !member?.gym_id || !gymInfo?.gym_owner_id) {
      toast.error("Gym context missing.");
      return;
    }
    if (!gymInfo?.upi_id) {
      toast.error("This gym hasn't set up UPI payments yet. Please contact the front desk.");
      return;
    }
    setShowPlansModal(false);
    setCheckoutPlan(plan);
  };

  const handleJoinGym = async (gymId: string) => {
    if (!member?.id) return;
    setIsSavingGymId(true);
    try {
      await supabase.from("profiles").upsert({ id: member.id, gym_id: gymId, full_name: member.full_name || "Member" }, { onConflict: 'id' });
      const { data: gymData } = await supabase.from("gym_settings").select("gym_owner_id").eq("id", gymId).maybeSingle();
      await supabase.from("members").upsert({ id: member.id, gym_id: gymId, gym_owner_id: gymData?.gym_owner_id || null, full_name: member.full_name || "Member", email: member.email }, { onConflict: 'id' });
      setMember((prev) => prev ? ({ ...prev, gym_id: gymId }) : null);
      await refreshGymContext(gymId, member.id);
      setSearchQuery(""); setSearchResults([]);
      toast.success("Welcome to the Family!");
      setTimeout(() => setShowPlansModal(true), 500);
    } catch (err: any) { toast.error("Failed to join gym."); } finally { setIsSavingGymId(false); }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "leaderboard", label: "Leaderboard", icon: Trophy },
    { id: "explorer", label: "Explorer", icon: MapIcon },
    { id: "attendance", label: "Attendance", icon: CalendarCheck2 },
    { id: "store", label: "Store", icon: ShoppingBag },
    { id: "notes", label: "Notes", icon: Dumbbell },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 bg-gray-50">
        <p className="text-lg text-gray-600">You are not logged in.</p>
        <Button onClick={() => navigate({ to: "/login" })}>Go to Login</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          >
            <div className="p-8 bg-white rounded-full shadow-2xl">
              <CheckCircle2 className="w-24 h-24 text-green-500" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-10 bg-background/70 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={member.avatar_url || undefined} alt={member.full_name || "Member"} />
            <AvatarFallback className="bg-gradient-brand text-white font-bold">{firstName.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">Hi, {firstName}!</h1>
            <p className="text-xs text-muted-foreground">
              {gymInfo?.gym_name ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3 text-indigo-500" />{gymInfo.gym_name}
                </span>
              ) : membershipName}
            </p>
          </div>
          <Badge variant={isRealtimeConnected ? "default" : "destructive"} className="ml-2 hidden items-center gap-1.5 sm:flex">
            <div className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
            {isRealtimeConnected ? "Live" : "Offline"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative rounded-full">
                <Bell className="w-5 h-5" />
                {unreadNotifications > 0 && (
                  <span className="absolute top-0 right-0 flex h-2 w-2">
                    <span className="absolute inline-flex w-full h-full bg-red-400 rounded-full opacity-75 animate-ping"></span>
                    <span className="relative inline-flex w-2 h-2 bg-red-500 rounded-full"></span>
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length > 0 ? (
                notifications.map(n => (
                  <DropdownMenuItem key={n.id} onSelect={(e) => e.preventDefault()} onClick={markNotificationsAsRead}>
                    <div className="flex flex-col">
                      <span className="font-medium">{n.activity_type}</span>
                      <span className="text-xs text-gray-500">{n.description}</span>
                    </div>
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="p-4 text-sm text-center text-gray-500">No new notifications</div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Settings className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setActiveTab('settings')}>
                <User className="w-4 h-4 mr-2" />
                <span>Profile Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="px-4 py-6 md:px-10 lg:py-8">
        {!member.gym_id ? (
          <div className="max-w-2xl mx-auto text-center">
            <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <Card className="border-white/10 bg-white/5 backdrop-blur-xl">
                <CardContent className="p-8">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-glow">
                    <Building2 className="w-8 h-8" />
                  </div>
                  <h2 className="mt-4 text-2xl font-bold tracking-tight">Join a Gym to Get Started</h2>
                  <p className="mt-2 text-muted-foreground">Search for your local gym to connect with your community and start tracking your progress.</p>
                  <div className="relative max-w-md mx-auto mt-6">
                    <Search className="absolute w-5 h-5 text-muted-foreground left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      type="text"
                      placeholder="Search for a gym by name or city..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 border-white/10 bg-white/5 backdrop-blur-xl"
                    />
                    {isSearching && <Loader2 className="absolute w-5 h-5 text-muted-foreground right-3 top-1/2 -translate-y-1/2 animate-spin" />}
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-4 space-y-2 text-left">
                      {searchResults.map(gym => (
                        <div key={gym.id} className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl transition-colors hover:border-primary/30">
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarImage src={gym.logo_url} />
                              <AvatarFallback className="bg-gradient-brand text-white font-bold">{gym.gym_name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold">{gym.gym_name}</p>
                              <p className="text-sm text-muted-foreground">{gym.city}</p>
                            </div>
                          </div>
                          <Button className="rounded-lg bg-gradient-brand text-white shadow-glow" onClick={() => handleJoinGym(gym.id)} disabled={isSavingGymId}>
                            {isSavingGymId ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        ) : (
          <>
            <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all ${
                    activeTab === tab.id
                      ? 'bg-gradient-brand text-white shadow-glow'
                      : 'border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:border-primary/30'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'dashboard' && (
                  <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                      {gymInfo && (
                        <Card className="relative overflow-hidden border-white/10 bg-gradient-brand-soft backdrop-blur-xl">
                          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow">
                                <Building2 className="h-6 w-6" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Your Gym</p>
                                <h3 className="truncate text-lg font-bold leading-tight tracking-tight">{gymInfo.gym_name}</h3>
                                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{gymInfo.address || gymInfo.city || "Location"}</span>
                                  {gymInfo.latitude != null && gymInfo.longitude != null && (
                                    <span className="ml-1 shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Located</span>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              {gymInfo.latitude != null && gymInfo.longitude != null && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg border-white/10 bg-white/5 backdrop-blur-xl"
                                  onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${gymInfo.latitude},${gymInfo.longitude}`, "_blank", "noopener")}
                                >
                                  <MapPin className="mr-1.5 h-3.5 w-3.5" /> Directions
                                </Button>
                              )}
                              <Button variant="outline" size="sm" className="rounded-lg border-white/10 bg-white/5 backdrop-blur-xl" onClick={() => setActiveTab('explorer')}>
                                <MapIcon className="mr-1.5 h-3.5 w-3.5" /> Map
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                      {/* Wall QR check-in — scan the gym's printed code to mark attendance */}
                      <Card className={`border-white/10 backdrop-blur-xl ${checkedInToday ? "border-emerald-500/40 bg-emerald-500/5" : "bg-white/5"}`}>
                        <CardContent className="flex flex-col items-center justify-between gap-4 py-5 sm:flex-row">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${checkedInToday ? "bg-emerald-500/15 text-emerald-500" : "bg-violet-500/15 text-violet-500"}`}>
                              {checkedInToday ? <CheckCircle2 className="h-6 w-6" /> : <QrCode className="h-6 w-6" />}
                            </div>
                            <div>
                              <p className="text-sm font-semibold">
                                {checkedInToday ? "You're checked in today 🎉" : "Not checked in yet"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {checkedInToday
                                  ? "Attendance recorded for today."
                                  : "Scan the gym's wall QR to mark today's attendance."}
                              </p>
                            </div>
                          </div>
                          <MemberWallCheckIn
                            memberId={member.id}
                            memberName={member.full_name ?? undefined}
                            onCheckedIn={() => { setCheckedInToday(true); fetchTodayCheckin(member.id); }}
                          />
                        </CardContent>
                      </Card>

                      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
                        {([
                          { title: "Today's Burn", icon: Flame, value: <AnimatedNumber value={todayCalories} />, sub: "calories" },
                          { title: "Gym Rank", icon: Trophy, value: `#${gymRank ?? 'N/A'}`, sub: `in ${gymInfo?.city || 'your city'}` },
                          { title: "Gym Vibe", icon: TrendingUp, value: <AnimatedNumber value={totalGymCalories} />, sub: "total calories today" },
                        ] as const).map((stat) => (
                          <Card key={stat.title} className="relative overflow-hidden border-white/10 bg-white/5 backdrop-blur-xl group hover:border-primary/30 transition-all h-full">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                              <stat.icon className="h-12 w-12" />
                            </div>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-3xl font-bold tracking-tight">{stat.value}</div>
                              <p className="mt-2 text-xs text-muted-foreground">{stat.sub}</p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      <Card className="border-white/10 bg-white/5 backdrop-blur-xl">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 tracking-tight">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow">
                              <Dumbbell className="w-5 h-5" />
                            </span>
                            Log a Workout
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4 md:flex-row">
                          <div className="flex-1">
                            <Label htmlFor="activity">Activity</Label>
                            <Select value={selectedActivity} onValueChange={setSelectedActivity}>
                              <SelectTrigger id="activity" className="border-white/10 bg-white/5 backdrop-blur-xl">
                                <SelectValue placeholder="Select activity" />
                              </SelectTrigger>
                              <SelectContent>
                                {activityOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1">
                            <Label htmlFor="duration">Duration (minutes)</Label>
                            <Input id="duration" type="number" value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)} className="border-white/10 bg-white/5 backdrop-blur-xl" />
                          </div>
                          <Button onClick={handleFinishSession} className="self-end w-full rounded-xl bg-gradient-brand text-white shadow-glow hover:shadow-primary/40 transition-all md:w-auto">
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Finish Session
                          </Button>
                        </CardContent>
                      </Card>

                      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <MemberGoalsCard memberId={member.id} category="diet" title="Diet Goals" />
                        <MemberGoalsCard memberId={member.id} category="exercise" title="Exercise Goals" />
                      </div>
                    </div>

                    <div className="space-y-6">
                      <MemberQRCard member={member} />
                      <MemberPurchaseHistory memberId={member.id} />
                    </div>
                  </div>

                  {/* Subscription + AI Assistant — full-width row, side-by-side on desktop, stacked on mobile */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <MemberActivePlans memberId={member.id} />
                    <MemberAIChat
                      gymId={gymInfo?.id ?? member.gym_id ?? null}
                      gymOwnerId={gymInfo?.gym_owner_id ?? null}
                      memberName={member.full_name ?? null}
                      memberPhone={member.mobile_number ?? member.phone ?? null}
                    />
                  </div>
                  </div>
                )}

                {activeTab === 'leaderboard' && (
                  <CityLeaderboard />
                )}
                {activeTab === 'explorer' && (
                  <CityGymExplorer
                    onJoinGym={handleJoinGym}
                    currentUserId={member.id}
                    currentGymId={gymInfo?.id || member.gym_id}
                    currentGym={gymInfo ? {
                      id: gymInfo.id,
                      gym_name: gymInfo.gym_name,
                      latitude: gymInfo.latitude ?? null,
                      longitude: gymInfo.longitude ?? null,
                      city: gymInfo.city,
                    } : undefined}
                  />
                )}
                {activeTab === 'attendance' && <MemberAttendanceTab memberId={member.id} />}
                {activeTab === 'store' && (
                  <MemberGymStore
                    memberId={member.id}
                    gymId={gymInfo?.id ?? member.gym_id ?? null}
                    gymOwnerId={gymInfo?.gym_owner_id ?? null}
                  />
                )}
                {activeTab === 'notes' && <MemberNotesTab memberId={member.id} />}
                {activeTab === 'settings' && (
                  <ProfileSettings
                    member={member}
                    gymInfo={gymInfo}
                    onUpdate={(newData) => setMember((prev) => prev ? ({ ...prev, ...newData }) : prev)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </main>

      <Dialog open={showMobilePrompt} onOpenChange={setShowMobilePrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Your Profile</DialogTitle>
            <DialogDescription>
              Add your mobile number to receive important updates and for easier account recovery.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <InternationalPhoneInput
              id="mobile-prompt"
              label="Mobile Number"
              value={mobileNumber}
              onChange={setMobileNumber}
              defaultCountryCode="+91"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={handleSkipMobile}>Skip</Button>
              <Button onClick={handleSaveMobile} disabled={isUpdatingMobile}>
                {isUpdatingMobile ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPlansModal} onOpenChange={setShowPlansModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose a Membership Plan</DialogTitle>
            <DialogDescription>Select a plan to unlock all features and start your fitness journey.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {gymPlans.map(plan => (
              <Card key={plan.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle>{plan.plan_name}</CardTitle>
                </CardHeader>
                <CardContent className="grow">
                  <p className="text-3xl font-bold">₹{plan.price}</p>
                  <p className="text-sm text-muted-foreground">for {plan.duration_days} days</p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {plan.features?.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <div className="p-6 pt-0">
                  <Button className="w-full" onClick={() => handleBuyPlan(plan)} disabled={isProcessingPayment}>
                    {isProcessingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : "Choose Plan"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {member && (
        <MemberUpiCheckout
          open={!!checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          plan={checkoutPlan}
          upiId={gymInfo?.upi_id}
          gymName={gymInfo?.gym_name || ""}
          memberId={member.id}
          gymId={member.gym_id || gymInfo?.id || ""}
          gymOwnerId={gymInfo?.gym_owner_id || ""}
          termsUrl={gymInfo?.terms_url}
          privacyUrl={gymInfo?.privacy_url}
          refundUrl={gymInfo?.refund_url}
          onSubmitted={() => member.gym_id && refreshGymContext(member.gym_id, member.id)}
        />
      )}

      {/* Legal & compliance footer (owner sets these in Settings → Gym Profile). */}
      <LegalLinksFooter
        termsUrl={gymInfo?.terms_url}
        privacyUrl={gymInfo?.privacy_url}
        refundUrl={gymInfo?.refund_url}
        className="px-6 py-8"
      />
    </div>
  );
}
