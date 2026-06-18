import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { buildJoinUrl } from "@/lib/app-url";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { 
  Plus, 
  QrCode, 
  TrendingUp, 
  Users, 
  AlertCircle, 
  ArrowUpRight, 
  Bell, 
  Search,
  Settings,
  LayoutDashboard,
  LogOut,
  X,
  UserPlus,
  Camera as CameraIcon,
  Building2,
  Copy,
  CheckCircle2,
  Sparkles,
  MessageSquare,
  Calendar,
  Monitor,
  Clock,
  Package,
  ShoppingBag,
  CreditCard,
  ChevronRight,
  TrendingDown,
  Activity,
  Menu,
  Loader2,
  Crown,
  Lock,
  Trophy,
  ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { supabase, supabaseUrl } from "@/supabase";
import { hasAccess, FeatureName, LIMITS } from "@/lib/permissions";
import { resolveSubscription, subscriptionHasFeature, nextTier, PLANS, formatINR, planAllows, requiredTierFor, type AppFeature, type PlanTier } from "@/lib/plans";
import { PlanUsageMeter } from "@/components/PlanUsageMeter";
import { UpgradeModal } from "@/components/UpgradeModal";
import { isApprovedPayment } from "@/lib/revenue";
import { IndianMobileInput } from "@/components/IndianMobileInput";
import { MembersList } from "@/components/MembersList";

import { FeatureGate } from "@/components/FeatureGate";
import RetentionWidget from "@/components/RetentionWidget";
import { OwnerPendingPayments } from "@/components/OwnerPendingPayments";
import { OwnerPendingStorePurchases } from "@/components/OwnerPendingStorePurchases";
import WhatsAppBotWidget from "@/components/WhatsAppBotWidget";
import AttendanceHeatmap from "@/components/AttendanceHeatmap";
import { InventoryManager } from "@/components/InventoryManager";
import { RevenueView } from "@/components/RevenueView";
import { SettingsView } from "@/components/SettingsView";
import { AttendanceView } from "@/components/AttendanceView";
import { AmbientBackground } from "@/components/AmbientBackground";
import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary";
import { isValidIndianMobile, looksLikeIndianMobile, toIndianE164, cleanPhoneInput, phoneForWaMe } from "@/lib/phone";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth-context";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from "@/components/ui/sheet";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      tab: (search.tab as string) || undefined,
      section: (search.section as string) || undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Dashboard — Gymphony Owner Center" },
      {
        name: "description",
        content: "Manage your gym's members, revenue, and attendance in one place.",
      },
    ],
  }),
  component: GuardedDashboard,
});

function GuardedDashboard() {
  return (
    <ProtectedRoute requiredRole="owner">
      <DashboardPage />
    </ProtectedRoute>
  );
}

// Persistent Data Cache
let statsCache = {
  totalMembersCount: 0,
  totalRevenue: 0,
  activeMembersCount: 0,
  liveMemberCount: 0,
  lastFetched: 0
};

const navItems = [
  { name: "Dashboard", icon: LayoutDashboard, feature: null },
  { name: "Members", icon: Users, feature: null },
  { name: "Attendance", icon: Calendar, feature: null },
  { name: "Revenue", icon: TrendingUp, feature: null, appFeature: "revenue_analytics" as AppFeature },
  { name: "🏆 Leaderboard", icon: Trophy, feature: null, appFeature: "leaderboard" as AppFeature, to: "/city-leaderboard" },
  { name: "Inventory", icon: Package, feature: null, appFeature: "inventory_management" as AppFeature },
  { name: "Plans", icon: CreditCard, feature: null },
  { name: "Kiosk Mode", icon: Monitor, feature: null, to: "/kiosk" },
  { name: "Settings", icon: Settings, feature: null },
];

const metricsTemplate = [
  { title: "Total Members", value: "0", change: "+0%", icon: Users, trend: "up" },
  { title: "Live Now", value: "0 Members", change: "Live", icon: Users, trend: "up", isLive: true },
  { title: "Total Revenue", value: "₹0", change: "+0%", icon: TrendingUp, trend: "up" },
  { title: "Active Members", value: "0", change: "+0%", icon: Users, trend: "up" },
  { title: "Pending Dues", value: "₹0", change: "0%", icon: AlertCircle, trend: "down" }
];

const isSchemaMismatchError = (error: any) => {
  const errorCode = String(error?.code || "");
  const errorMessage = String(error?.message || "").toLowerCase();

  return (
    errorCode === "PGRST204" ||
    errorCode === "23503" ||
    errorCode === "42P01" ||
    errorMessage.includes("column") ||
    errorMessage.includes("does not exist")
  );
};

type GymSettings = {
  id?: string;
  gym_owner_id?: string | null;
  plan_type?: string | null;
  expiry_date?: string | null;
  gym_name?: string | null;
  owner_email?: string | null;
  logo_url?: string | null;
  [key: string]: any;
};

type GymPlan = {
  id: string;
  name?: string | null;
  price?: number | null;
  duration?: number | null;
  gym_owner_id?: string | null;
  gym_id?: string | null;
  [key: string]: any;
};

function DashboardPage() {
  const navigate = useNavigate();
  const { user: authUser, isPlatformAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Locked-feature upgrade prompt (nav click on a feature above the plan).
  const [upgrade, setUpgrade] = useState<{ tier: PlanTier; label: string } | null>(null);

  // Tabs switch via state on the SAME route (not navigation), so the scroll
  // container keeps its position and looks like it "jumped". Reset it to top
  // whenever the active tab changes. (TanStack <ScrollRestoration/> wouldn't fire
  // here — there's no route change.)
  const mainScrollRef = useRef<HTMLElement>(null);
  // <main> is a custom overflow-y-auto scroll container (the page wrapper is
  // h-screen/overflow-hidden so the window itself never scrolls). On a hard
  // refresh or back-nav the browser/SSR could re-apply a previous scroll position
  // AFTER React mounts — which looked like the dashboard "auto-scrolling down".
  // Take manual control of restoration so nothing scrolls us unexpectedly.
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);
  // Pin to the top on load and on tab change — after paint (rAF) so our reset
  // wins over any late scroll restoration.
  useEffect(() => {
    const raf = requestAnimationFrame(() => mainScrollRef.current?.scrollTo({ top: 0 }));
    return () => cancelAnimationFrame(raf);
  }, [activeTab]);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [addMemberTab, setAddMemberTab] = useState("Manual Entry");
  const [memberIdToLink, setMemberIdToLink] = useState("");
  const [memberDetailsToLink, setMemberDetailsToLink] = useState<any>(null);
  const [isFetchingMemberToLink, setIsFetchingMemberToLink] = useState(false);
  const [isScanQROpen, setIsScanQROpen] = useState(false);

  // Fetch member details when ID is entered
  useEffect(() => {
    const fetchMember = async () => {
      if (!memberIdToLink || memberIdToLink.length < 4) {
        setMemberDetailsToLink(null);
        return;
      }

      setIsFetchingMemberToLink(true);
      try {
        // Search by short_id first, then by full id
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, short_id")
          .or(`short_id.eq.${memberIdToLink},id.eq.${memberIdToLink}`)
          .maybeSingle();

        if (error) throw error;
        setMemberDetailsToLink(data);
      } catch (err) {
        console.warn("Member fetch error:", err);
        setMemberDetailsToLink(null);
      } finally {
        setIsFetchingMemberToLink(false);
      }
    };

    const debounce = setTimeout(fetchMember, 500);
    return () => clearTimeout(debounce);
  }, [memberIdToLink]);

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isTrialExpired, setIsTrialExpired] = useState(false);
  const [isLimitReachedModalOpen, setIsLimitReachedModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [liveMemberCount, setLiveMemberCount] = useState(statsCache.liveMemberCount);
  const [totalMembersCount, setTotalMembersCount] = useState(statsCache.totalMembersCount);
  const [activeMembersCount, setActiveMembersCount] = useState(statsCache.activeMembersCount);
  const [totalRevenue, setTotalRevenue] = useState(statsCache.totalRevenue);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [revenueChange, setRevenueChange] = useState(0);
  const [pendingDues, setPendingDues] = useState(0);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [memberData, setMemberData] = useState<any>(null);
  const [checkedInMember, setCheckedInMember] = useState<any>(null);
  const [overdueMembersData, setOverdueMembersData] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [availablePlans, setAvailablePlans] = useState<GymPlan[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [gymSettings, setGymSettings] = useState<GymSettings | null>(null);
  const [showRenewalBanner, setShowRenewalBanner] = useState(false);
  const [daysUntilExpiry, setDaysUntilExpiry] = useState<number | null>(null);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isGymSettingsLoading, setIsGymSettingsLoading] = useState(true);
  const [isPlansLoading, setIsPlansLoading] = useState(true);
  const [plansFetchError, setPlansFetchError] = useState<string | null>(null);
  const [dashboardFatalError, setDashboardFatalError] = useState<string | null>(null);
  const isFetchingStatsRef = useRef(false);
  const dashboardFatalErrorRef = useRef(false);
  const dashboardErrorCountRef = useRef(0);
  // Ensures we only attempt to auto-provision a missing gym_settings row once.
  const gymProvisionTriedRef = useRef(false);

  const markDashboardFatalError = useCallback((context: string, error: any) => {
    if (dashboardFatalErrorRef.current) {
      return;
    }

    dashboardErrorCountRef.current += 1;
    if (dashboardErrorCountRef.current > 3) {
      console.error("[Dashboard] Error limit reached, stopping retries:", context, error);
      dashboardFatalErrorRef.current = true;
      isFetchingStatsRef.current = false;
      setIsLoadingStats(false);
      setIsGymSettingsLoading(false);
      setIsPlansLoading(false);
      setDashboardFatalError("Too many dashboard errors. Reload blocked to prevent flicker.");
      return;
    }

    dashboardFatalErrorRef.current = true;
    isFetchingStatsRef.current = false;
    setIsLoadingStats(false);

    const errorMessage = error instanceof Error
      ? error.message
      : String(error?.message || error || context);

    console.error(`[Dashboard Fatal] ${context}:`, error);
    setDashboardFatalError(errorMessage || context);
  }, []);

  useEffect(() => {
    // Identity comes from the global AuthProvider (single source of truth) — no
    // per-page getSession. The provider keeps authUser live across refreshes.
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboardLoadAttempted", "true");
    }

    const userId = authUser?.id;
    if (!userId) {
      // Either still resolving (root shows nothing until isLoading clears) or
      // signed out (root redirects to /login). Don't get stuck on the loader.
      setIsGymSettingsLoading(false);
      return;
    }

    setCurrentUserId(userId);
    setIsGymSettingsLoading(true);
    fetchGymSettings(userId);
  }, [authUser?.id]);

  // ⏱️ Safety timeout to reset stuck loading states
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isGymSettingsLoading) {
        console.warn("⏱️ [Loading Timeout] Gym settings loading stuck after 15s, forcing reset");
        setIsGymSettingsLoading(false);
      }
      if (isPlansLoading) {
        console.warn("⏱️ [Loading Timeout] Plans loading stuck after 15s, forcing reset");
        setIsPlansLoading(false);
      }
    }, 15000); // 15 second timeout

    return () => clearTimeout(timeout);
  }, [isGymSettingsLoading, isPlansLoading]);

  const { tab: searchTab, section: searchSection } = Route.useSearch();

  useEffect(() => {
    if (searchTab) {
      setActiveTab(searchTab);
    }
  }, [searchTab]);

  useEffect(() => {
    const handleSwitchTab = (e: any) => {
      if (e.detail) {
        setActiveTab(e.detail);
      }
    };
    window.addEventListener('switchTab', handleSwitchTab);
    return () => window.removeEventListener('switchTab', handleSwitchTab);
  }, []);

  useEffect(() => {
    const handleGymSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        setGymSettings(customEvent.detail);
      } else if (currentUserId) {
        fetchGymSettings(currentUserId);
      }
    };

    window.addEventListener("gym-settings-updated", handleGymSettingsUpdated as EventListener);
    return () => window.removeEventListener("gym-settings-updated", handleGymSettingsUpdated as EventListener);
  }, [currentUserId]);

  const fetchGymSettings = async (userId: string) => {
    if (dashboardFatalErrorRef.current) {
      setIsGymSettingsLoading(false);
      return;
    }

    setIsGymSettingsLoading(true);
    try {
      const { data, error } = await supabase
        .from("gym_settings")
        .select("*")
        .eq("gym_owner_id", userId)
        .maybeSingle(); // Use maybeSingle to avoid 406/500 if no record exists

      console.log("📊 [Gym Settings Fetch] User ID:", userId);
      console.log("📊 [Gym Settings Fetch] Response Data:", data);
      console.log("📊 [Gym Settings Fetch] Response Error:", error);
      
      if (error) {
        console.error("❌ [Gym Settings Fetch] Query failed:", error);
        setGymSettings({} as GymSettings);
        return;
      }

      if (!data?.gym_owner_id) {
        console.error("❌ [Gym Settings Fetch] Missing gym_owner_id in response:", data);
        // Self-heal: provision a gym_settings row + 7-day trial for owners who
        // don't have one yet (e.g. the signup RPC didn't run). One attempt only.
        if (!gymProvisionTriedRef.current) {
          gymProvisionTriedRef.current = true;
          try {
            const { error: ensureErr } = await supabase.rpc("ensure_gym_settings", {
              p_gym_id: null,
              p_gym_name: null,
              p_email: null,
            });
            if (!ensureErr) {
              await fetchGymSettings(userId); // refetch the freshly created row
              return;
            }
          } catch (e) {
            console.warn("ensure_gym_settings (dashboard self-heal) failed:", e);
          }
        }
        setGymSettings({} as GymSettings);
        return;
      }

      if (data) {
        console.log("✅ [Gym Settings Fetch] Successfully loaded:", {
          gymId: data.id,
          gymName: data.gym_name,
          gymOwner: data.gym_owner_id,
          planType: data.plan_type
        });
        setGymSettings(data);
        
        // Renewal Warning Logic with Null Checks
        try {
          if (data.plan_type === 'Pro' && data.expiry_date) {
            const expiryDate = new Date(data.expiry_date);
            const now = new Date();
            
            // Validate if expiryDate is a valid date
            if (!isNaN(expiryDate.getTime())) {
              const diffTime = expiryDate.getTime() - now.getTime();
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              
              setDaysUntilExpiry(diffDays);
              
              // Show banner if 3 days or less remaining, and not dismissed this session
              const isDismissed = sessionStorage.getItem('renewal_banner_dismissed') === 'true';
              if (diffDays <= 3 && !isDismissed) {
                setShowRenewalBanner(true);
              }
            } else {
              console.warn("Invalid expiry_date format:", data.expiry_date);
            }
          }
        } catch (dateErr) {
          console.error("Date comparison error in dashboard:", dateErr);
        }
      } else {
        // Default to Free if no settings found
        setGymSettings({} as GymSettings);
      }
    } catch (err) {
      console.error("Critical Exception in fetchGymSettings:", err);
      setGymSettings({} as GymSettings);
    } finally {
      setIsGymSettingsLoading(false);
    }
  };

  // New member form state
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberPlan, setNewMemberPlan] = useState("");
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastAddedMember, setLastAddedMember] = useState<any>(null);

  // ✅ Member QR Scanner state
  const [showMemberQRScanner, setShowMemberQRScanner] = useState(false);
  const [isScanningMember, setIsScanningMember] = useState(false);
  const [isLinkingMember, setIsLinkingMember] = useState(false);
  const memberQRScannerRef = useRef<Html5QrcodeScanner | null>(null);

  // ✅ Check-in (Scan QR) scanner state
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const checkInScannerRef = useRef<Html5QrcodeScanner | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!currentUserId || dashboardFatalErrorRef.current) {
      console.error("Dashboard Error: currentUserId is undefined in fetchNotifications");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq('gym_owner_id', currentUserId)
        .order("created_at", { ascending: false })
        .limit(20);

      console.log("Dashboard Data (Notifications):", data);
      if (error) {
        markDashboardFatalError("notifications query failed", error);
        return;
      }
      
      const formatted = (data || []).map(n => ({
        id: n.id,
        title: n.activity_type.charAt(0).toUpperCase() + n.activity_type.slice(1),
        message: n.description,
        time: new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isRead: n.is_read,
        type: n.activity_type
      }));

      setNotifications(formatted);
      setUnreadCount(formatted.filter((n) => !n.isRead).length);
    } catch (err) {
      console.warn("Error fetching notifications:", err);
    }
  }, [currentUserId, markDashboardFatalError]);

  const markNotificationsAsRead = async () => {
    if (!currentUserId) return;
    if (unreadCount === 0) return;
    // Optimistic: flip locally, then persist atomically via the auth-scoped RPC.
    const prevList = notifications;
    const prevCount = unreadCount;
    setUnreadCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));

    // Prefer the atomic RPC; if it isn't deployed yet (migration 20260624 not
    // applied) fall back to a direct owner-scoped update so mark-all-read keeps
    // working against the current schema.
    let { error } = await supabase.rpc("mark_notifications_read");
    if (error) {
      const res = await supabase
        .from("activity_log")
        .update({ is_read: true })
        .eq("gym_owner_id", currentUserId)
        .eq("is_read", false);
      error = res.error;
    }
    if (error) {
      // Roll back so the badge never lies about server state.
      setNotifications(prevList);
      setUnreadCount(prevCount);
      console.warn("Error marking notifications as read:", error);
      toast.error("Couldn't mark notifications as read. Please try again.");
      return;
    }
    toast.success("All notifications marked as read");
  };

  const fetchAvailablePlans = useCallback(async () => {
    if (!currentUserId || dashboardFatalErrorRef.current) {
      console.error("Dashboard Error: currentUserId is undefined in fetchAvailablePlans");
      return;
    }

    setIsPlansLoading(true);
    setPlansFetchError(null);

    try {
      console.log("📋 [Plans Fetch] Starting plans fetch for user:", currentUserId);
      
      // First try to fetch from gym_plans without depending on gym_owner_id
      const { data: plansData, error: plansError } = await supabase
        .from("gym_plans")
        .select("*")
        .order("name", { ascending: true });

      console.log("📋 [Plans Fetch] Response from gym_plans:", plansData?.length || 0, "plans");
      console.log("📋 [Plans Fetch] Response error:", plansError);
      
      if (plansError) {
        if (isSchemaMismatchError(plansError)) {
          console.error("❌ [Plans Fetch] Schema mismatch detected:", plansError);
          setPlansFetchError("Plans schema mismatch detected. Showing empty state.");
        } else {
          console.error("❌ [Plans Fetch] Query failed:", plansError);
          setPlansFetchError("Failed to load plans. Showing empty state.");
        }

        setAvailablePlans([]);
        const { data: membersData, error: membersError } = await supabase
          .from("members")
          .select("membership_plan")
          .eq('gym_owner_id', currentUserId);

        if (!membersError) {
          const distinctPlans = Array.from(new Set((membersData || [])
            .map(m => m.membership_plan)
            .filter(Boolean)))
            .map(planName => ({
              id: String(planName),
              name: String(planName),
              price: 0,
              duration: 1
            }));

          console.log("📋 [Plans Fetch] Fallback to members table:", distinctPlans.length, "distinct plans");
          setAvailablePlans(distinctPlans);
          if (distinctPlans.length > 0) {
            setPlansFetchError(null);
          }
        }

        return;
      }

      if (!plansData) {
        console.log("📋 [Plans Fetch] Empty data returned, keeping stable empty state");
        setAvailablePlans([]);
        return;
      }

      const filteredPlans = plansData.filter((plan: GymPlan) => {
        if (!plan?.gym_owner_id) return true;
        return plan.gym_owner_id === currentUserId;
      });

      console.log("✅ [Plans Fetch] Filtered plans:", filteredPlans.length, "matching current user");

      if (filteredPlans.length > 0) {
        setAvailablePlans(filteredPlans);
      } else {
        // Fallback: Fetch distinct plans from members table if gym_plans is empty
        const { data: membersData, error: membersError } = await supabase
          .from("members")
          .select("membership_plan")
          .eq('gym_owner_id', currentUserId);

        if (membersError) {
          markDashboardFatalError("member plans fallback query failed", membersError);
          return;
        }

        const distinctPlans = Array.from(new Set((membersData || [])
          .map(m => m.membership_plan)
          .filter(Boolean)))
          .map(planName => ({
            id: String(planName),
            name: String(planName),
            price: 0, // Fallback price
            duration: 1 // Fallback duration
          }));
        
        console.log("📋 [Plans Fetch] Using fallback plans from members:", distinctPlans.length, "distinct plans");
        setAvailablePlans(distinctPlans);
      }
    } catch (err) {
      console.warn("❌ [Plans Fetch] Exception:", err);
      setPlansFetchError("Unable to load plans right now.");
      setAvailablePlans([]);
    } finally {
      setIsPlansLoading(false);
    }
  }, [currentUserId, markDashboardFatalError]);

  const fetchLiveMemberCount = useCallback(async () => {
    if (!currentUserId || dashboardFatalErrorRef.current) return;
    try {
      const ownerGymId = gymSettings?.id;
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();

      let query = supabase
        .from("check_ins")
        .select("*", { count: 'exact', head: true })
        .gte("created_at", twoHoursAgo);

      // Explicitly scope the live count to this gym for code-level visibility
      // and double safety (RLS already restricts rows to the owner's gym).
      if (ownerGymId) {
        query = query.eq("gym_id", ownerGymId);
      }

      const { count, error } = await query;

      if (error) {
        markDashboardFatalError("live member count query failed", error);
        return;
      }
      setLiveMemberCount(count || 0);
      statsCache.liveMemberCount = count || 0;
    } catch (err) {
      console.warn("Error fetching live member count:", err);
    }
  }, [currentUserId, gymSettings?.id, markDashboardFatalError]);

  const fetchMembersCounts = useCallback(async () => {
    if (!currentUserId || dashboardFatalErrorRef.current || isFetchingStatsRef.current) {
      console.error("Dashboard Error: currentUserId is undefined in fetchMembersCounts");
      return;
    }
    isFetchingStatsRef.current = true;
    setIsLoadingStats(true);
    try {
      // 1. Get the owner's Gym ID first
      const { data: gymData } = await supabase
        .from("gym_settings")
        .select("id")
        .eq("gym_owner_id", currentUserId)
        .maybeSingle();

      const gymId = gymData?.id;
      console.log("📍 [Members Count] Current User ID:", currentUserId);
      console.log("📍 [Members Count] Gym ID from settings:", gymId);

      // 2. Fetch members with both owner and gym filter
      let query = supabase
        .from("members")
        .select("id, status, membership_plan, full_name, expiry_date, amount_paid, created_at, gym_id, mobile_number, phone");
      
      if (gymId) {
        query = query.or(`gym_owner_id.eq.${currentUserId},gym_id.eq.${gymId}`);
        console.log("📍 [Members Count] Using OR filter with gym_owner_id and gym_id");
      } else {
        query = query.eq('gym_owner_id', currentUserId);
        console.log("📍 [Members Count] Using gym_owner_id filter only (no gym_id found)");
      }

      const { data, error } = await query;
      console.log("📊 [Members Count] Members fetched:", data?.length || 0, "members");
      console.log("📊 [Members Count] Error:", error);

      if (error) {
        if (isSchemaMismatchError(error)) {
          markDashboardFatalError("members query schema mismatch", error);
          return;
        }

        markDashboardFatalError("members query failed", error);
        return;
      }

      const memberRows = data || [];
      const memberIds = memberRows.map((member: any) => member.id).filter(Boolean);

      let amountPaidById = new Map<string, number>();
      if (memberIds.length > 0) {
        const { data: profileAmounts, error: profileAmountsError } = await supabase
          .from("profiles")
          .select("id, amount_paid")
          .in("id", memberIds);

        if (!profileAmountsError) {
          amountPaidById = new Map(
            (profileAmounts || []).map((row: any) => [row.id, Number(row.amount_paid) || 0])
          );
        } else {
          console.warn("📊 [Members Count] Profile amount fetch error:", profileAmountsError);
        }
      }

      const latestMembers = memberRows.map((member: any) => ({
        ...member,
        amount_paid: amountPaidById.has(member.id)
          ? amountPaidById.get(member.id)
          : Number(member.amount_paid) || 0
      }));

      const totalCount = latestMembers.length;
      const activeCount = latestMembers.filter(m => m.status?.toLowerCase() === 'active').length;

      console.log("📊 [Members Count] Total members:", totalCount);
      console.log("📊 [Members Count] Active members:", activeCount);

      setTotalMembersCount(totalCount);
      statsCache.totalMembersCount = totalCount;
      setActiveMembersCount(activeCount);
      statsCache.activeMembersCount = activeCount;

      // Revenue comes from the payments ledger, NOT members.amount_paid — and
      // ONLY approved (Paid/Success) rows count. This keeps the dashboard's
      // headline numbers identical to the Revenue Analytics page and prevents
      // pending_verification / rejected payments from inflating revenue.
      // (approve_payment flips a UPI payment to 'Success' but does not touch
      // members.amount_paid, so members.amount_paid alone would miss approved
      // UPI revenue entirely.)
      const { data: paymentRows, error: paymentsError } = await supabase
        .from("payments")
        .select("amount, status, created_at")
        .eq("gym_owner_id", currentUserId);

      if (paymentsError) {
        console.warn("📊 [Revenue] Payments fetch error:", paymentsError);
      }
      const approvedPayments = (paymentRows || []).filter((p: any) => isApprovedPayment(p.status));

      // Plan Prices - This should ideally come from gym_plans table
      const planPrices: Record<string, number> = {
        'Monthly': 1000,
        'Quarterly': 2500,
        'Yearly': 8000
      };

      // Calculate Total Revenue and Pending Dues
      let totalRev = 0;
      let totalPending = 0;
      let currentMonthRev = 0;
      let lastMonthRev = 0;

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
      const lastMonth = lastMonthDate.getMonth();
      const lastMonthYear = lastMonthDate.getFullYear();

      // Check for expired members and update status in DB if needed
      const expiredMemberIds: string[] = [];

      // Pending dues + auto-expiry are still driven by the members table
      // (amount_paid vs plan price); revenue is computed separately below from
      // the approved payments ledger.
      latestMembers.forEach(m => {
        const paid = Number(m.amount_paid) || 0;

        const planName = m.membership_plan || 'Monthly';
        const price = planPrices[planName] || 0; // Use 0 if plan not found to avoid fake numbers
        const due = Math.max(0, price - paid);
        totalPending += due;

        // Expiry Logic: Check if membership end date has passed today
        if (m.expiry_date && new Date(m.expiry_date) < now && m.status?.toLowerCase() === 'active') {
          expiredMemberIds.push(m.id);
        }
      });

      // Revenue = approved payments only, matching the Revenue Analytics page.
      approvedPayments.forEach((p: any) => {
        const amount = Number(p.amount) || 0;
        totalRev += amount;

        const createdAt = new Date(p.created_at);
        if (createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear) {
          currentMonthRev += amount;
        } else if (createdAt.getMonth() === lastMonth && createdAt.getFullYear() === lastMonthYear) {
          lastMonthRev += amount;
        }
      });

      // Auto-expire overdue members via a SECURITY DEFINER RPC. A client-side
      // write can't do this: `members` is a non-updatable view, and an owner
      // can't update another user's `profiles` row under RLS. The RPC scopes to
      // this owner's gym and writes the base `profiles` table.
      if (expiredMemberIds.length > 0) {
        console.log(`Auto-expiry: Marking ${expiredMemberIds.length} members as Inactive`);
        supabase
          .rpc("expire_overdue_members")
          .then(({ error }) => {
            if (error) console.error("Auto-expiry RPC failed:", error);
          });
      }

      setTotalRevenue(totalRev);
      statsCache.totalRevenue = totalRev;
      setMonthlyRevenue(currentMonthRev);
      setPendingDues(totalPending);

      const change = lastMonthRev === 0 ? (currentMonthRev > 0 ? 100 : 0) : ((currentMonthRev - lastMonthRev) / lastMonthRev) * 100;
      setRevenueChange(change);

      // Build the 'Action Needed' list. A member needs the owner's attention for
      // EITHER of two reasons:
      //   • dues    — they still owe part of the plan price (price − amount_paid)
      //   • renewal — their plan has expired (expiry_date in the past), so even a
      //               fully-paid member needs a renewal nudge.
      // Both surface a "Send Reminder" action; dues are prioritised, then by how
      // long a plan has been expired.
      const nowMs = Date.now();
      const overdue = latestMembers
        .map(m => {
          const paid = Number(m.amount_paid) || 0;
          const planName = m.membership_plan || 'Monthly';
          const price = planPrices[planName] || 0;
          const due = Math.max(0, price - paid);
          const memberPhone = m.mobile_number || m.phone || "";
          const expiryMs = m.expiry_date ? new Date(m.expiry_date).getTime() : NaN;
          const isExpired = !isNaN(expiryMs) && expiryMs < nowMs;

          const kind: 'dues' | 'renewal' | null =
            due > 0 ? 'dues' : isExpired ? 'renewal' : null;

          return {
            name: m.full_name,
            plan: m.membership_plan,
            phone: memberPhone,
            mobile_number: memberPhone,
            expiry_date: m.expiry_date,
            dueAmount: due,
            amount: due > 0 ? `₹${due.toLocaleString()}` : '',
            kind,
            expiryMs: isNaN(expiryMs) ? Infinity : expiryMs,
          };
        })
        .filter(m => m.kind !== null)
        // Dues first (higher amount first), then renewals by longest-expired.
        .sort((a, b) =>
          b.dueAmount - a.dueAmount || a.expiryMs - b.expiryMs
        )
        .slice(0, 5);

      setOverdueMembersData(overdue);

    } catch (err: any) {
      console.warn("Error fetching member counts:", err.message);
    } finally {
      isFetchingStatsRef.current = false;
      setIsLoadingStats(false);
    }
  }, [currentUserId, markDashboardFatalError]);




  const fetchRecentActivities = useCallback(async () => {
    if (!currentUserId || dashboardFatalErrorRef.current) {
      console.error("Dashboard Error: currentUserId is undefined in fetchRecentActivities");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("activity_log")
        .select("description, created_at, activity_type")
        .eq('gym_owner_id', currentUserId)
        .order("created_at", { ascending: false })
        .limit(5);
      
      console.log("Dashboard Data (Recent Activities):", data);
            if (error) {
              markDashboardFatalError("recent activities query failed", error);
              return;
            }
      
      const formatted = (data || []).map(log => {
        const timestamp = new Date(log.created_at);
        const diffInMinutes = Math.floor((new Date().getTime() - timestamp.getTime()) / (1000 * 60));
        
        let timeStr = "";
        if (diffInMinutes < 1) timeStr = "Just now";
        else if (diffInMinutes < 60) timeStr = `${diffInMinutes}m ago`;
        else if (diffInMinutes < 1440) timeStr = `${Math.floor(diffInMinutes / 60)}h ago`;
        else timeStr = timestamp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

        return {
          name: log.description,
          time: timeStr,
          type: log.activity_type.charAt(0).toUpperCase() + log.activity_type.slice(1)
        };
      });

      setRecentActivities(formatted);
    } catch (err) {
      console.warn("Error fetching recent activities:", err);
    }
  }, [currentUserId, markDashboardFatalError]);

  const fetchLowStock = useCallback(async () => {
    if (!currentUserId || dashboardFatalErrorRef.current) {
      console.error("Dashboard Error: currentUserId is undefined in fetchLowStock");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("inventory")
        .select("item_name, stock_quantity")
        .eq('gym_owner_id', currentUserId)
        .lt("stock_quantity", 10) // Threshold for low stock
        .limit(5);

      console.log("Dashboard Data (Low Stock):", data);
      if (error) {
        markDashboardFatalError("inventory query failed", error);
        return;
      }
      
      // Map to UI format
      const mappedItems = (data || []).map(item => ({
        name: item.item_name,
        quantity: item.stock_quantity
      }));
      setLowStockItems(mappedItems);
    } catch (err) {
      console.warn("Error fetching low stock:", err);
    }
  }, [currentUserId, markDashboardFatalError]);

  const handleCheckIn = async (memberId: string) => {
    try {
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("full_name, membership_plan")
        .eq("id", memberId)
        .single();

      if (memberError || !member) {
        toast.error("Member not found");
        return;
      }

      const { error: checkInError } = await supabase
        .from("check_ins")
        .insert([{ member_id: memberId, gym_id: gymSettings?.id ?? null, check_in_time: new Date().toISOString() }]);

      if (checkInError) throw checkInError;

      if (currentUserId) {
        await supabase.from("activity_log").insert([{
          gym_owner_id: currentUserId,
          activity_type: "attendance",
          description: `${member.full_name} checked in.`,
          is_read: false
        }]);
      }

      fetchLiveMemberCount();
      setCheckedInMember({ name: member.full_name, plan: member.membership_plan });
      
      setTimeout(() => setCheckedInMember(null), 3000);
      toast.success(`Welcome back, ${member.full_name}!`);
      fetchRecentActivities();
    } catch (err) {
      console.warn("Check-in error:", err);
      toast.error("Check-in failed");
    }
  };

  // ✅ Open the Scan QR modal; the scanner is initialized by an effect once the
  // #reader element is mounted in the DOM.
  const startScanner = () => {
    setIsScanQROpen(true);
  };

  // ✅ Tear down the check-in scanner and close the modal.
  const handleCloseQRScanner = useCallback(() => {
    if (checkInScannerRef.current) {
      checkInScannerRef.current.clear().catch(() => {});
      checkInScannerRef.current = null;
    }
    setIsScanQROpen(false);
    setIsCheckingIn(false);
  }, []);

  // ✅ Initialize the check-in QR scanner (reuses the existing handleCheckIn
  // logic that writes to check_ins, logs activity and updates the live count).
  const initializeCheckInScanner = useCallback(() => {
    if (checkInScannerRef.current || !isScanQROpen) return;

    const scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
      false
    );

    const onScanSuccess = async (decodedText: string) => {
      // Member QR codes encode the raw members.id UUID. Fall back to a
      // member_id query param if the QR happens to be a URL.
      let memberId = decodedText.trim();
      try {
        if (memberId.includes("?") || memberId.includes("&")) {
          const url = new URL(memberId, window.location.origin);
          memberId = url.searchParams.get("member_id") || memberId;
        }
      } catch {
        // Not a URL — keep the raw decoded text.
      }

      if (!memberId) {
        toast.error("Invalid QR code. No member ID found.");
        return;
      }

      setIsCheckingIn(true);

      // Stop the scanner first to prevent duplicate scans of the same code.
      if (checkInScannerRef.current) {
        await checkInScannerRef.current.clear().catch(() => {});
        checkInScannerRef.current = null;
      }

      await handleCheckIn(memberId);

      setIsScanQROpen(false);
      setIsCheckingIn(false);
    };

    const onScanFailure = () => {
      // Silently ignore per-frame scan failures.
    };

    try {
      scanner.render(onScanSuccess, onScanFailure);
      checkInScannerRef.current = scanner;
    } catch (error) {
      console.error("Failed to initialize check-in scanner:", error);
      toast.error("Could not access camera. Please check permissions.");
      setIsScanQROpen(false);
    }
  }, [isScanQROpen]);

  const handleSaveMember = async () => {
    if (!newMemberName || !newMemberPhone || !newMemberPlan) {
      toast.error("Please fill in all fields");
      return;
    }

    if (!looksLikeIndianMobile(newMemberPhone)) {
      toast.error("Enter a valid 10-digit Indian mobile number");
      return;
    }
    const normalizedMemberPhone = toIndianE164(newMemberPhone);

    // Enforce the real per-tier member cap (Starter 100 / Growth 500 / Pro ∞),
    // resolved from the live subscription — no hardcoded limit.
    const planSub = resolveSubscription(gymSettings);
    if (Number.isFinite(planSub.memberLimit) && totalMembersCount >= planSub.memberLimit) {
      setIsAddMemberOpen(false);
      setIsLimitReachedModalOpen(true);
      return;
    }

    setIsSavingMember(true);
    try {
      const selectedPlan = availablePlans.find(p => p.id === newMemberPlan);
      if (!selectedPlan) throw new Error("Plan not found");

      // Get owner's gym ID from settings
      const ownerGymId = gymSettings?.id;
      if (!ownerGymId) {
        toast.error("Gym profile not found. Please complete your gym setup first.");
        setIsSavingMember(false);
        return;
      }

      // Proactively reject duplicate phone numbers within this gym before
      // inserting, so the owner gets a clear message instead of a DB error.
      const { data: existingMember, error: duplicateCheckError } = await supabase
        .from("members")
        .select("id")
        .eq("gym_owner_id", currentUserId)
        .or(`mobile_number.eq.${normalizedMemberPhone},phone.eq.${normalizedMemberPhone}`)
        .limit(1)
        .maybeSingle();

      if (duplicateCheckError) {
        console.warn("Duplicate phone check failed, continuing to insert:", duplicateCheckError);
      } else if (existingMember) {
        toast.error("A member with this phone number already exists in your gym.");
        setIsSavingMember(false);
        return;
      }

      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + (selectedPlan.duration || 1));

      const { data: newMember, error: insertError } = await supabase
        .from("members")
        .insert([{
          full_name: newMemberName,
          mobile_number: normalizedMemberPhone,
          phone: normalizedMemberPhone,
          membership_plan: selectedPlan.name,
          expiry_date: expiryDate.toISOString(),
          status: "Pending",
          auth_user_id: null,
          gym_id: ownerGymId,
          gym_owner_id: currentUserId // associate invitation slot with this owner
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      // Log activity for invitation creation (does not mark member active)
      if (currentUserId) {
        await supabase.from("activity_log").insert([{
          gym_owner_id: currentUserId,
          activity_type: "invitation_created",
          description: `Invitation slot created for ${newMemberName}.`,
          is_read: false
        }]);
      }

      setMemberData(newMember);
      setLastAddedMember({ ...newMember, price: selectedPlan.price });
      setIsAddMemberOpen(false);
      setShowSuccessModal(true);
      toast.success("Member added successfully!");
      
      // Reset form
      setNewMemberName("");
      setNewMemberPhone("");
      setNewMemberPlan("");
      
      // NOTE: Do not refresh members count for invitation slots — count should update
      // only when the invited member completes signup and becomes Active.
    } catch (error: any) {
      console.warn("Error saving member:", error);

      const code = String(error?.code || "");
      const message = String(error?.message || "").toLowerCase();

      // 23505 = Postgres unique_violation — covers the race where a duplicate
      // phone slips past the pre-check above.
      if (code === "23505" || message.includes("duplicate") || message.includes("already exists")) {
        toast.error("A member with this phone number already exists in your gym.");
      } else if (error?.message) {
        toast.error(`Failed to save member: ${error.message}`);
      } else {
        toast.error("Failed to save member");
      }
    } finally {
      setIsSavingMember(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      localStorage.clear();
      navigate({ to: "/login" });
      toast.success("Logged out successfully");
    } catch (error) {
      console.warn("Logout error:", error);
    }
  };

  const cleanReminderPhone = (value?: string) => cleanPhoneInput(value);

  const normalizeReminderPhone = (value?: string) => {
    const cleaned = cleanReminderPhone(value);

    if (!cleaned) {
      return "";
    }

    if (!looksLikeIndianMobile(cleaned)) {
      return "";
    }

    return toIndianE164(cleaned);
  };

  const handleSendReminder = async (name: string, phone?: string, amount?: string, kind: 'dues' | 'renewal' = 'dues') => {
    const cleanedPhone = cleanReminderPhone(phone);

    if (!cleanedPhone) {
      toast.error("Phone number missing for this member");
      return;
    }

    const cleanPhone = normalizeReminderPhone(cleanedPhone);

    if (!cleanPhone) {
      toast.error("Please enter a valid international phone number");
      return;
    }

    const whatsappPhone = phoneForWaMe(cleanPhone);
    const reminderId = `${name}-${cleanPhone}`;
    
    setSendingReminderId(reminderId);
    
    try {
      console.log(`n8n: Triggering reminder for ${name}...`);
      
      const n8nWebhookUrl = "https://primary-production-4592.up.railway.app/webhook/gym-reminder";
      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: cleanPhone,
          amount: amount || "pending amount",
          reason: kind, // 'dues' | 'renewal' — lets the automation pick a template
          timestamp: new Date().toISOString()
        })
      });

      if (response.ok) {
        toast.success(`Reminder sent to ${name} ✅`);
      } else {
        throw new Error("Automation offline");
      }
    } catch (error) {
      console.warn("Reminder: Falling back to manual WhatsApp", error);
      
      // Fallback to manual WhatsApp link — message tailored to the reason.
      const message = kind === 'renewal'
        ? `Hello ${name}, your gym membership has expired. Please renew it soon to continue enjoying uninterrupted access. See you at the gym! 💪`
        : `Hello ${name}, your gym fee of ${amount || "pending amount"} is pending. Please clear it soon to avoid any interruption to your access!`;
      const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`;
      
      // Open in new tab
      window.open(whatsappUrl, '_blank');
      toast.info(`Opening WhatsApp for manual reminder...`);
    } finally {
      setSendingReminderId(null);
    }
  };

  const handleCopyLink = () => {
    try {
      const ownerGymId = gymSettings?.id ?? currentUserId ?? "";
      const inviteLink = buildJoinUrl(ownerGymId);
      navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied to clipboard");
    } catch (err) {
      console.warn("Copy failed:", err);
      toast.error("Could not copy link");
    }
  };

  // ✅ NEW: Initialize member QR scanner
  const initializeMemberQRScanner = useCallback(() => {
    if (memberQRScannerRef.current || !showMemberQRScanner) return;

    const scanner = new Html5QrcodeScanner(
      "member-qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    const onScanSuccess = async (decodedText: string) => {
      setIsScanningMember(true);

      try {
        // Extract member_id from QR code (UUID format)
        let memberId = decodedText;

        // If it's a URL, extract member_id parameter
        if (decodedText.includes("?") || decodedText.includes("&")) {
          const url = new URL(decodedText, window.location.origin);
          memberId = url.searchParams.get("member_id") || decodedText;
        }

        if (!memberId || memberId.length === 0) {
          toast.error("Invalid QR code. No member ID found.");
          setIsScanningMember(false);
          return;
        }

        // Stop scanner before linking
        if (memberQRScannerRef.current) {
          await memberQRScannerRef.current.clear();
          memberQRScannerRef.current = null;
        }

        // Link member to gym
        await handleLinkMemberToGym(memberId);
      } catch (error) {
        console.error("QR scan error:", error);
        toast.error("Could not process QR code. Please try again.");
        setIsScanningMember(false);
      }
    };

    const onScanFailure = () => {
      // Silently ignore scan failures
    };

    try {
      scanner.render(onScanSuccess, onScanFailure);
      memberQRScannerRef.current = scanner;
    } catch (error) {
      console.error("Failed to initialize QR scanner:", error);
      toast.error("Could not access camera. Please check permissions.");
      setShowMemberQRScanner(false);
    }
  }, [showMemberQRScanner]);

  // ✅ NEW: Link member to gym by updating profiles table
  const handleLinkMemberToGym = async (memberId: string) => {
    if (!gymSettings?.id) {
      toast.error("Gym profile not found. Please complete your gym setup first.");
      return;
    }

    setIsLinkingMember(true);

    try {
      // 1. Search for the member in 'profiles' table using short_id (6B1F3D9B style)
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, short_id")
        .eq("short_id", memberId)
        .maybeSingle();

      if (profileError || !profileData) {
        toast.error("Member with this ID not found. Please check the short_id.");
        setIsLinkingMember(false);
        return;
      }

      const actualMemberId = profileData.id;

      // 2. Update profiles table with owner's gym_id
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ gym_id: gymSettings.id })
        .eq("id", actualMemberId);

      if (updateError) throw updateError;

      // 3. Also update members table gym_id and gym_owner_id for consistency
      const { error: memberUpdateError } = await supabase
        .from("members")
        .update({ 
          gym_id: gymSettings.id,
          gym_owner_id: currentUserId 
        })
        .eq("id", actualMemberId);

      if (memberUpdateError) {
        console.warn("Could not update members table:", memberUpdateError);
      }

      // 4. Log activity
      if (currentUserId) {
        await supabase.from("activity_log").insert([{
          gym_owner_id: currentUserId,
          member_id: actualMemberId,
          activity_type: "member_joined",
          description: `${profileData.full_name} joined your gym via short_id link.`,
          is_read: false
        }]);
      }

      toast.success(`✅ ${profileData.full_name} Linked Successfully!`);
      setShowMemberQRScanner(false);
      setMemberIdToLink("");
      setMemberDetailsToLink(null);
      setAddMemberTab("Manual Entry");
      
      // Refresh stats
      fetchMembersCounts();
      fetchRecentActivities();
    } catch (error) {
      console.error("Unexpected error linking member:", error);
      toast.error("Linking failed. Please try again.");
    } finally {
      setIsLinkingMember(false);
      setIsScanningMember(false);
    }
  };

  // ✅ NEW: Close member QR scanner
  const handleCloseMemberQRScanner = useCallback(() => {
    if (memberQRScannerRef.current) {
      memberQRScannerRef.current.clear().catch(() => {});
      memberQRScannerRef.current = null;
    }
    setShowMemberQRScanner(false);
    setIsScanningMember(false);
  }, []);

  // ✅ Initialize scanner when tab changes
  useEffect(() => {
    initializeMemberQRScanner();
  }, [showMemberQRScanner, initializeMemberQRScanner]);

  // ✅ Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (memberQRScannerRef.current) {
        memberQRScannerRef.current.clear().catch(() => {});
      }
    };
  }, []);

  // ✅ Initialize the check-in scanner when the Scan QR modal opens. A short
  // delay ensures the #reader element is mounted before html5-qrcode binds.
  useEffect(() => {
    if (!isScanQROpen) return;

    const timer = setTimeout(() => {
      initializeCheckInScanner();
    }, 300);

    return () => {
      clearTimeout(timer);
      if (checkInScannerRef.current) {
        checkInScannerRef.current.clear().catch(() => {});
        checkInScannerRef.current = null;
      }
    };
  }, [isScanQROpen, initializeCheckInScanner]);

  useEffect(() => {
    if (dashboardFatalErrorRef.current) {
      return;
    }

    if (currentUserId) {
      const ownerGymId = gymSettings?.id;

      fetchMembersCounts();
      fetchRecentActivities();
      // Respect the owner's "Low Stock / Inventory Alerts" preference.
      if (gymSettings?.notify_low_stock !== false) fetchLowStock();
      fetchAvailablePlans();
      fetchNotifications();
      fetchLiveMemberCount();

      // Auto-refresh live count every 60 seconds
      const liveRefreshInterval = setInterval(fetchLiveMemberCount, 60000);

      const channelId = Math.random().toString(36).substring(7);

      // Coalesce realtime bursts. members/profiles/payments inserts can arrive in
      // flurries (a payment batch, a bulk import, auto-expiry); without this each
      // event re-ran the full fetchMembersCounts triple-query — a query storm at
      // scale. Debouncing collapses a burst into ONE trailing refetch.
      const debouncedMembersCounts = debounce(() => fetchMembersCounts(), 400);
      const debouncedActivity = debounce(() => {
        // Keep both the notifications bell and the Activity Log panel live.
        fetchNotifications();
        fetchRecentActivities();
      }, 400);
      // Live count is a cheap head-count, but every check-in fires it; debounce
      // briefly so a rush at peak hours doesn't issue one query per scan.
      const debouncedLiveCount = debounce(() => fetchLiveMemberCount(), 600);

      const handleMemberPaymentUpdated = () => debouncedMembersCounts();

      window.addEventListener("member-payment-updated", handleMemberPaymentUpdated as EventListener);

      let realtimeChannel = supabase
        .channel(`dashboard_realtime_${channelId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `gym_owner_id=eq.${currentUserId}` }, debouncedActivity)
        .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `gym_owner_id=eq.${currentUserId}` }, debouncedMembersCounts)
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `gym_owner_id=eq.${currentUserId}` }, debouncedMembersCounts)
        // Keep revenue live when a payment is logged, approved, or rejected.
        .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `gym_owner_id=eq.${currentUserId}` }, debouncedMembersCounts);

      // Only listen to THIS gym's check-ins. Attached once the gym id is known
      // so we never subscribe to cross-gym attendance inserts.
      if (ownerGymId) {
        realtimeChannel = realtimeChannel.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "check_ins", filter: `gym_id=eq.${ownerGymId}` },
          debouncedLiveCount
        );
      }

      const channel = realtimeChannel.subscribe();

      return () => {
        clearInterval(liveRefreshInterval);
        debouncedMembersCounts.cancel();
        debouncedActivity.cancel();
        debouncedLiveCount.cancel();
        window.removeEventListener("member-payment-updated", handleMemberPaymentUpdated as EventListener);
        supabase.removeChannel(channel);
      };
    }
  }, [currentUserId, gymSettings?.id]);

  const dynamicMetrics = metricsTemplate.map(m => {
    if (m.title === "Total Members") return { ...m, value: `${totalMembersCount}` };
    if (m.title === "Live Now") return { ...m, value: `${liveMemberCount} Members` };
    if (m.title === "Total Revenue") return { ...m, value: `₹${totalRevenue.toLocaleString()}` };
    if (m.title === "Active Members") return { ...m, value: `${activeMembersCount}` };
    if (m.title === "Pending Dues") return { ...m, value: `₹${pendingDues.toLocaleString()}` };
    if (m.title === "Monthly Revenue") {
      return { 
        ...m, 
        value: `₹${monthlyRevenue.toLocaleString()}`,
        change: `${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}%`,
        trend: revenueChange >= 0 ? "up" : "down"
      };
    }
    return m;
  });

  if (dashboardFatalError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <span className="text-2xl font-bold">!</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard Error</h1>
          <p className="mt-3 text-sm text-slate-300">
            A database error was detected, so the dashboard was frozen to prevent flicker and reload loops.
          </p>
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-left text-sm text-red-100">
            {dashboardFatalError}
          </div>
        </div>
      </div>
    );
  }

  if (isGymSettingsLoading) {
    return (
      <DashboardErrorBoundary>
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Loading Dashboard</h1>
            <p className="mt-2 text-sm text-slate-300">
              Fetching gym settings and stabilizing the dashboard.
            </p>
          </div>
        </div>
      </DashboardErrorBoundary>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "Dashboard":
        return (
          <>
            {/* Quick Actions */}
            <section className="flex flex-wrap items-center gap-4">
              <Button 
                onClick={() => setIsAddMemberOpen(true)}
                className="h-12 px-6 rounded-xl bg-gradient-brand text-white font-bold shadow-glow hover:shadow-primary/40 transition-all"
              >
                <Plus className="mr-2 h-5 w-5" />
                Add Member
              </Button>
              <Button 
                variant="outline" 
                onClick={startScanner}
                className="h-12 px-6 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 font-bold"
              >
                <QrCode className="mr-2 h-5 w-5 text-primary" />
                Scan QR
              </Button>
              <div className="ml-auto hidden md:flex relative max-w-xs w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search members..." 
                  className="w-full h-11 pl-10 pr-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                />
              </div>
            </section>

            {/* Metric Cards */}
            <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {dynamicMetrics.map((m, i) => (
                <motion.div
                  key={m.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Card className="relative overflow-hidden border-white/10 bg-white/5 backdrop-blur-xl group hover:border-primary/30 transition-all h-full">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                      <m.icon className="h-12 w-12" />
                    </div>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">{m.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {isLoadingStats ? (
                        <div className="flex items-center gap-2 py-2">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground italic">Syncing...</span>
                        </div>
                      ) : (
                        <>
                          <div className="text-3xl font-bold tracking-tight">
                            {m.value}
                          </div>
                          <div className="mt-2 flex items-center gap-1 text-xs">
                            {m.isLive ? (
                              <div className="flex items-center gap-1.5 text-green-500 font-bold uppercase tracking-wider">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                {m.change}
                              </div>
                            ) : (
                              <>
                                <span className={m.trend === 'up' ? 'text-green-400' : 'text-red-400'}>
                                  {m.change}
                                </span>
                                <span className="text-muted-foreground">vs last month</span>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </section>

            {/* Pending UPI payments approval — ALWAYS available (self-hides only when
                there's nothing to approve). The "Alert on Pending UPI Payments"
                preference only controls the toast when a new one arrives, not this UI. */}
            <OwnerPendingPayments
              ownerId={currentUserId}
              alertsEnabled={gymSettings?.notify_pending_payment !== false}
            />

            {/* Pending store purchases paid via UPI — approve to finalize, reject
                to restore the reserved stock. Self-hides when nothing's pending. */}
            <OwnerPendingStorePurchases
              ownerId={currentUserId}
              alertsEnabled={gymSettings?.notify_pending_payment !== false}
            />

            {/* Action Needed & Activity Log */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-2xl font-bold flex items-center gap-2">
                    <AlertCircle className="h-6 w-6 text-red-400" />
                    Action Needed
                  </h2>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden shadow-2xl">
                  <div className="divide-y divide-white/10 max-h-80 overflow-y-auto overflow-x-hidden custom-scrollbar">
                    {overdueMembersData.length > 0 ? (
                      overdueMembersData.map((member, i) => (
                        <div key={member.name} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/5 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-full bg-red-400/10 flex items-center justify-center">
                              <AlertCircle className="h-6 w-6 text-red-400" />
                            </div>
                            <div>
                              <div className="font-bold text-lg">{member.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {member.plan} • {member.kind === 'renewal' ? (
                                  <span className="text-amber-400 font-medium">Plan expired — renewal due</span>
                                ) : (
                                  <span className="text-red-400 font-medium">{member.amount} Overdue</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <FeatureGate
                            feature="whatsapp_reminders"
                            label="Automated WhatsApp Reminders"
                            subscription={gymSettings}
                          >
                            {(() => {
                              const reminderPhone = member.phone || member.mobile_number || "";
                              const reminderKeyPhone = normalizeReminderPhone(reminderPhone);
                              const reminderKey = reminderKeyPhone ? `${member.name}-${reminderKeyPhone}` : `${member.name}-missing`;

                              return (
                            <Button 
                              onClick={() => handleSendReminder(member.name, reminderPhone, member.amount, member.kind)}
                              className={`rounded-xl bg-primary text-white font-bold px-6 h-11 shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all ${sendingReminderId === reminderKey ? 'opacity-50 cursor-not-allowed' : ''}`}
                              disabled={sendingReminderId === reminderKey}
                            >
                              {sendingReminderId === reminderKey ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  Send Reminder
                                  <ArrowUpRight className="ml-2 h-4 w-4" />
                                </>
                              )}
                            </Button>
                              );
                            })()}
                          </FeatureGate>
                        </div>
                      ))
                    ) : (
                      <div className="p-12 text-center space-y-3">
                        <div className="text-4xl">🎉</div>
                        <p className="text-xl font-bold text-white">All caught up!</p>
                        <p className="text-muted-foreground">No pending dues or renewals at the moment.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <h2 className="font-display text-2xl font-bold flex items-center gap-2">
                  <Clock className="h-6 w-6 text-primary" />
                  Activity Log
                </h2>
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-6 max-h-80 overflow-y-auto overflow-x-hidden custom-scrollbar">
                  {recentActivities.length > 0 ? (
                    recentActivities.map((activity, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                            {activity.type[0]}
                          </div>
                          <div>
                            <div className="text-sm font-bold line-clamp-1">{activity.name}</div>
                            <div className="text-[10px] text-muted-foreground">{activity.type}</div>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap ml-2">{activity.time}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">No recent activity</div>
                  )}
                </div>
              </div>
            </section>

            <PlanUsageMeter
              gymSettings={gymSettings}
              memberCount={totalMembersCount}
              onUpgrade={() => {
                navigate({ to: '/dashboard', search: (prev: any) => ({ ...prev, tab: 'Settings', section: 'Billing & Plans' }) });
                setActiveTab("Settings");
              }}
            />

            <AttendanceHeatmap />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <FeatureGate feature="ai_features" label="AI Retention Engine" subscription={gymSettings}>
                <RetentionWidget />
              </FeatureGate>
              <FeatureGate feature="ai_features" label="WhatsApp AI Bot" subscription={gymSettings}>
                <WhatsAppBotWidget />
              </FeatureGate>
            </div>
          </>
        );
      case "Members":
        return (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h1 className="font-display text-3xl font-bold md:text-4xl">
                  Manage <span className="text-gradient-brand">Members</span>
                </h1>
                <p className="mt-1 text-muted-foreground">View and manage your gym's growing community.</p>
              </div>
              <Button 
                onClick={() => setIsAddMemberOpen(true)}
                className="h-12 px-6 rounded-xl bg-gradient-brand text-white font-bold"
              >
                <Plus className="mr-2 h-5 w-5" />
                Add New Member
              </Button>
            </div>
            <PlanUsageMeter
              gymSettings={gymSettings}
              memberCount={totalMembersCount}
              onUpgrade={() => {
                navigate({ to: '/dashboard', search: (prev: any) => ({ ...prev, tab: 'Settings', section: 'Billing & Plans' }) });
                setActiveTab("Settings");
              }}
            />
            <MembersList />
          </motion.div>
        );
      case "Attendance":
        return <AttendanceView />;
      case "Revenue":
        return <RevenueView />;
      case "Inventory":
        return (
          <InventoryManager />
        );
      case "Plans":
        return <SettingsView initialCategory="Billing & Plans" />;
      case "Settings":
        return <SettingsView initialCategory={searchSection || "Gym Profile"} />;
      default:
        return (
          <div className="text-center py-40">
            <h2 className="text-3xl font-bold">{activeTab} View Coming Soon</h2>
            <Button onClick={() => setActiveTab("Dashboard")} className="mt-4">Back to Dashboard</Button>
          </div>
        );
    }
  };

  // Respect the owner's notification preferences in the activity feed: hide
  // new-member entries when "Alert on New Member Signup" is off, and inventory
  // entries when "Low Stock / Inventory Alerts" is off.
  const visibleNotifications = notifications.filter((n) => {
    const t = String(n.type || "").toLowerCase();
    if (gymSettings?.notify_new_member === false && (t === "member_joined" || t === "member")) return false;
    if (gymSettings?.notify_low_stock === false && (t.includes("stock") || t.includes("inventory"))) return false;
    return true;
  });
  // Badge counts only the notifications actually shown, so it never disagrees
  // with the (filtered) feed.
  const visibleUnreadCount = visibleNotifications.filter((n) => !n.isRead).length;

  // Notification bell + dropdown, extracted so it can render in BOTH the desktop
  // header and the mobile header (previously the bell was desktop-only, so mobile
  // owners had no access to notifications). State is shared; only the
  // breakpoint-visible copy is ever on screen.
  const notificationsBell = (
    <div className="relative">
      <Button
        variant="outline"
        size="icon"
        className="rounded-full bg-white border border-slate-200 hover:border-primary/30 hover:bg-primary/5 text-slate-600 hover:text-primary transition-all shadow-sm relative group"
        onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 transition-transform group-hover:rotate-12" />
        {visibleUnreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-gradient-brand border-2 border-white rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg">
            {visibleUnreadCount}
          </span>
        )}
      </Button>

      <AnimatePresence>
        {isNotificationsOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setIsNotificationsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-4 w-80 max-w-[calc(100vw-2rem)] bg-white border border-primary/10 rounded-3xl shadow-elegant z-40 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-brand" />
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-900">Notifications</h3>
                <button
                  onClick={markNotificationsAsRead}
                  className="text-xs font-bold text-primary hover:text-primary/80 transition-colors"
                >
                  Mark all as read
                </button>
              </div>
              <div className="max-h-100 overflow-y-auto custom-scrollbar">
                {visibleNotifications.length > 0 ? (
                  visibleNotifications.map((n) => (
                    <div key={n.id} className={`p-5 border-b border-slate-50 hover:bg-primary/5 transition-colors ${!n.isRead ? 'bg-primary/2' : ''}`}>
                      <div className="flex justify-between items-start mb-1.5">
                        <span className="text-[10px] font-black text-primary uppercase tracking-widest">{n.title}</span>
                        <span className="text-[10px] font-medium text-slate-400">{n.time}</span>
                      </div>
                      <p className="text-sm text-slate-700 font-medium leading-relaxed">{n.message}</p>
                    </div>
                  ))
                ) : (
                  <div className="p-10 text-center space-y-2">
                    <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto text-slate-300">
                      <Bell className="h-6 w-6" />
                    </div>
                    <p className="text-slate-400 text-sm font-medium">No new notifications</p>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <DashboardErrorBoundary>
    <div className="relative w-full h-screen bg-slate-50 text-foreground flex flex-col overflow-hidden">
      <AmbientBackground />
      {upgrade && (
        <UpgradeModal
          open={!!upgrade}
          onClose={() => setUpgrade(null)}
          requiredTier={upgrade.tier}
          featureLabel={upgrade.label}
        />
      )}
      <AnimatePresence>
        {showRenewalBanner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-amber-500 text-white overflow-hidden relative z-150"
          >
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 animate-bounce" />
                <p className="text-sm font-bold tracking-wide">
                  Bhai, your Pro plan expires in {daysUntilExpiry} {daysUntilExpiry === 1 ? 'day' : 'days'}. Renew now to keep your unlimited features!
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button 
                  size="sm"
                  onClick={() => {
                    navigate({ 
                      to: '/dashboard', 
                      search: (prev: any) => ({ ...prev, tab: 'Settings', section: 'Billing & Plans' }) 
                    });
                    setActiveTab("Settings");
                  }}
                  className="bg-white text-amber-600 hover:bg-white/90 font-black px-4 rounded-lg shadow-sm"
                >
                  Renew Now
                </Button>
                <button 
                  onClick={() => {
                    setShowRenewalBanner(false);
                    sessionStorage.setItem('renewal_banner_dismissed', 'true');
                  }}
                  className="p-1 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-1 overflow-hidden">
        <AnimatePresence>
          {isTrialExpired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-slate-900/95 backdrop-blur-xl"
          >
            <div className="w-full max-w-lg bg-white rounded-[3rem] p-12 text-center space-y-8 shadow-2xl border border-white/20">
              <div className="h-24 w-24 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <Lock className="h-12 w-12 text-red-500" />
              </div>
              <div className="space-y-3">
                <h2 className="text-4xl font-bold text-slate-900 tracking-tight">Trial Expired</h2>
                <p className="text-slate-500 text-lg font-medium">
                  Your 30-day free trial has ended. Upgrade to <span className="text-primary font-bold">Gymphony Pro</span> to continue managing your gym.
                </p>
              </div>
              <div className="pt-4 space-y-4">
                <Button 
                  onClick={() => {
                    navigate({ 
                      to: '/dashboard', 
                      search: (prev: any) => ({ ...prev, tab: 'Settings', section: 'Billing & Plans' }) 
                    });
                    setActiveTab("Settings");
                  }}
                  className="w-full h-16 rounded-2xl bg-gradient-brand text-white font-bold text-xl shadow-glow"
                >
                  Upgrade to Pro Now
                </Button>
                <button 
                  onClick={handleLogout}
                  className="text-slate-400 font-bold hover:text-slate-600 transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {isLimitReachedModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-md"
          >
            <div className="w-full max-w-md bg-white rounded-[2.5rem] p-10 text-center space-y-8 shadow-2xl relative">
              <button 
                onClick={() => setIsLimitReachedModalOpen(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
              
              <div className="h-20 w-20 bg-amber-50 rounded-3xl flex items-center justify-center mx-auto">
                <Users className="h-10 w-10 text-amber-500" />
              </div>
              
              {(() => {
                const sub = resolveSubscription(gymSettings);
                const up = nextTier(sub.tier);
                const upPlan = up ? PLANS[up] : null;
                return (
                <>
              <div className="space-y-3">
                <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Limit Reached!</h2>
                <p className="text-slate-500 font-medium">
                  You have reached your <span className="text-slate-900 font-bold">{sub.plan.name} plan limit of {Number.isFinite(sub.memberLimit) ? sub.memberLimit.toLocaleString("en-IN") : "unlimited"} members</span>.
                  {upPlan ? <> Upgrade to <span className="text-slate-900 font-bold">{upPlan.name}</span> for {Number.isFinite(upPlan.memberLimit) ? `up to ${upPlan.memberLimit.toLocaleString("en-IN")}` : "unlimited"} members and more.</> : null}
                </p>
              </div>

                <div className="space-y-4 pt-2">
                  <Button
                    onClick={() => {
                      navigate({
                        to: '/dashboard',
                        search: (prev: any) => ({ ...prev, tab: 'Settings', section: 'Billing & Plans' })
                      });
                      setIsLimitReachedModalOpen(false);
                      setActiveTab("Settings");
                    }}
                    className="w-full h-14 rounded-2xl bg-gradient-brand text-white font-bold text-lg shadow-glow hover:shadow-primary/40 transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles className="h-5 w-5" />
                    {upPlan ? `Upgrade to ${upPlan.name} · ${formatINR(upPlan.priceMonthly)}/mo` : "View Plans"}
                  </Button>
                  <div className="flex flex-col gap-3 pt-2">
                    {(upPlan?.highlights ?? []).slice(0, 4).map((feat, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm text-slate-600 font-medium justify-center">
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                        {feat}
                      </div>
                    ))}
                  </div>
                  <button 
                    onClick={() => setIsLimitReachedModalOpen(false)}
                    className="text-slate-400 font-bold hover:text-slate-600 transition-colors text-sm pt-2"
                  >
                    Maybe Later
                  </button>
                </div>
                </>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar (Desktop) */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-white/10 bg-white/5 backdrop-blur-xl z-20">
        <Link to="/" className="p-8 group">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-brand flex items-center justify-center transition-transform group-hover:scale-110">
              <span className="font-bold text-white">G</span>
            </div>
            <span className="font-display text-xl font-bold tracking-tight">Gymphony</span>
          </div>
        </Link>
        
        <nav className="grow px-4 space-y-2">
          {navItems.map((item) => {
            const appFeature = (item as any).appFeature as AppFeature | undefined;
            // Gated items carry an appFeature; everything else is baseline (always allowed).
            const hasFeatureAccess = appFeature ? planAllows(gymSettings, appFeature) : true;

            return (
              <button
                key={item.name}
                onClick={() => {
                  // Locked feature → open the Upgrade modal instead of navigating.
                  if (appFeature && !hasFeatureAccess) {
                    setUpgrade({ tier: requiredTierFor(appFeature), label: item.name.replace(/^🏆\s*/, "") });
                    return;
                  }
                  if (item.to) {
                    navigate({ to: item.to as "/city-leaderboard" | "/kiosk" });
                    return;
                  }

                  setActiveTab(item.name);
                }}
                className={`flex items-center justify-between px-4 py-3 w-full rounded-xl transition-all ${
                  activeTab === item.name
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="h-5 w-5" />
                  <span className="text-sm">{item.name}</span>
                </div>
                {!hasFeatureAccess && (
                  <Lock className="h-3 w-3 opacity-50" />
                )}
              </button>
            );
          })}

          {/* Platform admin only — jump to the super-admin panel (/admin). */}
          {isPlatformAdmin && (
            <button
              onClick={() => navigate({ to: "/admin" })}
              className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-primary hover:bg-primary/10 transition-all"
            >
              <ShieldCheck className="h-5 w-5" />
              <span className="text-sm font-medium">Admin Panel</span>
            </button>
          )}
        </nav>

        <div className="p-6 mt-auto">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </aside>

      <main ref={mainScrollRef} className="grow relative overflow-y-auto px-6 py-8 md:px-10 lg:py-12">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-brand flex items-center justify-center">
              <span className="font-bold text-white text-xs">G</span>
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Gymphony</span>
          </Link>
          <div className="flex items-center gap-2">
            {notificationsBell}
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl border-white/10 bg-white/5" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-slate-950 border-white/10 text-white w-72">
              <SheetHeader className="text-left px-2 mb-8">
                <SheetTitle className="text-white flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-gradient-brand flex items-center justify-center">
                    <span className="font-bold text-white text-xs">G</span>
                  </div>
                  Gymphony
                </SheetTitle>
              </SheetHeader>
              <nav className="space-y-2">
                {navItems.map((item) => {
                  const appFeature = (item as any).appFeature as AppFeature | undefined;
                  // Gated items carry an appFeature; everything else is baseline (always allowed).
                  const hasFeatureAccess = appFeature ? planAllows(gymSettings, appFeature) : true;
                  return (
                    <button
                      key={item.name}
                      onClick={() => {
                        // Locked feature → open the Upgrade modal instead of navigating.
                        if (appFeature && !hasFeatureAccess) {
                          setUpgrade({ tier: requiredTierFor(appFeature), label: item.name.replace(/^🏆\s*/, "") });
                          setIsMobileMenuOpen(false);
                          return;
                        }
                        if (item.to) {
                          navigate({ to: item.to as "/city-leaderboard" | "/kiosk" });
                          setIsMobileMenuOpen(false);
                          return;
                        }

                        setActiveTab(item.name);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`flex items-center justify-between px-4 py-3 w-full rounded-xl transition-all ${
                        activeTab === item.name 
                          ? "bg-primary/10 text-primary font-medium" 
                          : "text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="h-5 w-5" />
                        <span className="text-sm">{item.name}</span>
                      </div>
                      {!hasFeatureAccess && (
                        <Lock className="h-3 w-3 opacity-50" />
                      )}
                    </button>
                  );
                })}

                {/* Platform admin only — jump to the super-admin panel (/admin). */}
                {isPlatformAdmin && (
                  <button
                    onClick={() => {
                      navigate({ to: "/admin" });
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-primary transition-all hover:bg-primary/10"
                  >
                    <ShieldCheck className="h-5 w-5" />
                    <span className="text-sm font-medium">Admin Panel</span>
                  </button>
                )}
              </nav>

              <div className="mt-6 border-t border-white/10 pt-6">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground transition-colors hover:bg-red-400/10 hover:text-red-400"
                >
                  <LogOut className="h-5 w-5" />
                  <span className="text-sm">Logout</span>
                </button>
              </div>
            </SheetContent>
          </Sheet>
          </div>
        </div>

        {/* Header (Desktop) */}
        <div className="hidden lg:flex items-center justify-between mb-12 z-20 relative">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">
              Owner <span className="text-gradient-brand">Dashboard</span>
            </h1>
            <p className="mt-2 text-muted-foreground font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Your gym is growing. Here's the latest performance.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full bg-white border border-slate-200 hover:border-primary/30 hover:bg-primary/5 text-slate-600 hover:text-primary transition-all shadow-sm group"
              title="Launch Kiosk Mode"
              onClick={() => window.open('/kiosk', '_blank')}
            >
              <Monitor className="h-5 w-5" />
            </Button>

            {notificationsBell}

            <div className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="h-10 w-10 rounded-full bg-gradient-brand p-0.5 transition-transform hover:scale-105 overflow-hidden flex items-center justify-center"
              >
                {gymSettings?.logo_url ? (
                  <img
                    src={gymSettings.logo_url}
                    alt={`${gymSettings.gym_name || 'Gym'} logo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full rounded-full bg-slate-950 flex items-center justify-center overflow-hidden">
                    <Users className="h-5 w-5 text-white" />
                  </div>
                )}
              </button>

              <AnimatePresence>
                {isProfileOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setIsProfileOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-4 w-64 bg-white border border-primary/10 rounded-3xl shadow-elegant z-40 overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-brand" />
                      <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                        <p className="font-bold text-slate-900 leading-none mb-1">{gymSettings?.gym_name || 'Gym Owner'}</p>
                        <p className="text-xs text-slate-500 font-medium">{gymSettings?.owner_email || 'owner@gymphony.com'}</p>
                      </div>
                      <div className="p-2">
                        <button 
                          onClick={() => { setActiveTab("Settings"); setIsProfileOpen(false); }} 
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-700 rounded-xl hover:bg-primary/5 hover:text-primary transition-all group"
                        >
                          <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                            <Settings className="h-4 w-4 text-slate-400 group-hover:text-primary" />
                          </div>
                          Settings
                        </button>
                        <button 
                          onClick={handleLogout} 
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-red-600 rounded-xl hover:bg-red-50 transition-all group"
                        >
                          <div className="h-8 w-8 rounded-lg bg-red-50/50 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                            <LogOut className="h-4 w-4 text-red-400 group-hover:text-red-600" />
                          </div>
                          Logout
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="relative max-w-7xl mx-auto space-y-10">
          <AnimatePresence>
            {checkedInMember && (
              <motion.div
                initial={{ opacity: 0, y: -50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="fixed top-10 left-1/2 -translate-x-1/2 z-100 w-full max-w-md px-6 pointer-events-none"
              >
                <div className="bg-slate-900/90 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-2xl text-center">
                  <div className="h-16 w-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/30">
                    <CheckCircle2 className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold">Welcome back, {checkedInMember.name}!</h3>
                  <p className="text-muted-foreground">{checkedInMember.plan} Member</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {renderTabContent()}
        </div>
      </main>

      {/* Add Member Modal */}
      <AnimatePresence>
        {isAddMemberOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm" onClick={() => setIsAddMemberOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-[2rem] overflow-hidden shadow-2xl p-8 space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold text-slate-900">Add Member</h3>
                <button onClick={() => setIsAddMemberOpen(false)}><X className="h-6 w-6 text-slate-400" /></button>
              </div>

              <div className="flex p-1 bg-slate-100 rounded-2xl overflow-x-auto">
                {["Manual Entry", "Share QR", "Scan Member", "Add by ID"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setAddMemberTab(tab);
                      if (tab === "Scan Member") {
                        setShowMemberQRScanner(true);
                      }
                    }}
                    className={`flex-1 py-2 px-3 text-[10px] md:text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
                      addMemberTab === tab ? "bg-white text-primary shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {addMemberTab === "Manual Entry" ? (
                <div className="space-y-4">
                  {/* ... existing manual entry fields ... */}
                  <div className="space-y-2">
                    <Label className="text-slate-600">Full Name</Label>
                    <Input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} className="bg-slate-50 text-slate-900" />
                  </div>
                  <div className="space-y-2">
                    <IndianMobileInput
                      id="new-member-phone"
                      label="Phone Number"
                      value={newMemberPhone}
                      onChange={setNewMemberPhone}
                      placeholder="9876543210"
                      error={newMemberPhone && !isValidIndianMobile(newMemberPhone) ? "Enter a valid 10-digit Indian mobile number" : undefined}
                      className="group"
                      inputClassName="bg-slate-50 text-slate-900 border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-600">Plan</Label>
                    <Select value={newMemberPlan} onValueChange={setNewMemberPlan}>
                      <SelectTrigger className="bg-slate-50 text-slate-900">
                        <SelectValue placeholder="Select plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {isPlansLoading ? (
                          <SelectItem value="__loading" disabled>Loading plans...</SelectItem>
                        ) : availablePlans.length > 0 ? (
                          availablePlans.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name || p.id} (₹{p.price ?? 0})</SelectItem>
                          ))
                        ) : (
                          <SelectItem value="__empty" disabled>{plansFetchError || "No Plans Found"}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleSaveMember} disabled={isSavingMember} className="w-full h-12 bg-primary text-white font-bold rounded-xl">
                    {isSavingMember ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </span>
                    ) : (
                      "Save Member"
                    )}
                  </Button>
                </div>
              ) : addMemberTab === "Share QR" ? (
                <div className="text-center space-y-4">
                  {/* ... existing Share QR ... */}
                  <div className="mx-auto w-48 h-48 bg-slate-50 rounded-3xl border-2 border-slate-100 flex items-center justify-center p-4">
                      {(() => {
                        const ownerGymId = gymSettings?.id ?? currentUserId ?? "";
                        const inviteLink = buildJoinUrl(ownerGymId);
                        return <QRCodeSVG value={inviteLink} size={320} className="w-full h-full" />;
                      })()}
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-slate-700">Invite Link</p>
                      <div className="wrap-break-word rounded-2xl bg-slate-50 p-3 text-xs text-slate-700 border border-slate-100">
                        {buildJoinUrl(gymSettings?.id ?? currentUserId ?? "")}
                      </div>
                    </div>

                  <Button onClick={handleCopyLink} className="w-full h-12 bg-primary/10 text-primary font-bold rounded-xl border border-primary/10">
                    Copy Invite Link
                  </Button>
                </div>
              ) : addMemberTab === "Scan Member" ? (
                <div className="text-center space-y-4">
                  {/* ... existing Scan Member ... */}
                  <p className="text-sm text-slate-600 font-medium">Point camera at member QR code</p>
                  {!isScanningMember && (
                    <div
                      id="member-qr-reader"
                      className="rounded-2xl border-2 border-dashed border-primary bg-slate-50 overflow-hidden"
                      style={{ minHeight: "300px" }}
                    />
                  )}
                  {isScanningMember && (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 rounded-2xl bg-slate-50">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm font-medium text-slate-600">
                        {isLinkingMember ? "Linking member..." : "Processing QR code..."}
                      </p>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    onClick={handleCloseMemberQRScanner}
                    disabled={isScanningMember}
                    className="w-full h-12 rounded-2xl border-slate-200 text-slate-700 font-semibold"
                  >
                    Close Scanner
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-slate-600">Enter Member ID</Label>
                    <div className="relative">
                      <Input 
                        value={memberIdToLink} 
                        onChange={(e) => setMemberIdToLink(e.target.value)} 
                        placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                        className="bg-slate-50 text-slate-900 rounded-xl h-12 pr-10"
                      />
                      {isFetchingMemberToLink && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400">Ask the member for their ID from their dashboard.</p>
                  </div>

                  {memberDetailsToLink && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex items-center gap-4"
                    >
                      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary overflow-hidden">
                        {memberDetailsToLink.avatar_url ? (
                          <img src={memberDetailsToLink.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <UserPlus className="h-6 w-6" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{memberDetailsToLink.full_name}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest">Profile Found</p>
                      </div>
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </motion.div>
                  )}

                  <Button 
                    onClick={() => handleLinkMemberToGym(memberIdToLink)} 
                    disabled={isLinkingMember || !memberDetailsToLink}
                    className="w-full h-12 bg-primary text-white font-bold rounded-xl shadow-glow"
                  >
                    {isLinkingMember ? "Linking..." : "Confirm & Link Member"}
                  </Button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* QR Scanner Modal */}
      <AnimatePresence>
        {isScanQROpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md" onClick={handleCloseQRScanner}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-slate-900 rounded-[2.5rem] p-10 space-y-8 text-center border border-white/10"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold text-white">Scan Member QR</h3>
                <button onClick={handleCloseQRScanner}><X className="h-6 w-6 text-white/40" /></button>
              </div>
              <p className="text-sm text-white/50 font-medium -mt-4">Hold a member's QR code up to the camera to check them in.</p>
              <div className="relative aspect-square max-w-70 mx-auto">
                <div id="reader" className="aspect-square w-full rounded-3xl overflow-hidden bg-black border-2 border-primary/30"></div>
                {isCheckingIn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl bg-black/60 backdrop-blur-sm">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm font-semibold text-white">Checking in…</p>
                  </div>
                )}
              </div>
              <Button onClick={handleCloseQRScanner} className="w-full h-14 bg-white/10 text-white font-bold rounded-2xl">Close</Button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  </div>
    </DashboardErrorBoundary>
);
}

export default DashboardPage;
