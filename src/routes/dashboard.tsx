import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  Lock
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
import { supabase, supabaseUrl } from "@/supabase";
import { initiatePhonePePayment, finalizeUpgrade as finalizePhonePeUpgrade } from "@/lib/phonepe";
import { hasAccess, FeatureName, LIMITS } from "@/lib/permissions";
import { getGymInitials } from "@/lib/utils";
import { MembersList } from "@/components/MembersList";
import { KioskMode } from "@/components/KioskMode";
import { FeatureLock } from "@/components/FeatureLock";
import RetentionWidget from "@/components/RetentionWidget";
import WhatsAppBotWidget from "@/components/WhatsAppBotWidget";
import AttendanceHeatmap from "@/components/AttendanceHeatmap";
import { InventoryManager } from "@/components/InventoryManager";
import { RevenueView } from "@/components/RevenueView";
import { SettingsView } from "@/components/SettingsView";
import { AttendanceView } from "@/components/AttendanceView";
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
  component: DashboardPage,
});

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
  { name: "Revenue", icon: TrendingUp, feature: 'advanced_analytics' },
  { name: "Inventory", icon: Package, feature: 'advanced_analytics' }, // Grouped under analytics for now
  { name: "Plans", icon: CreditCard, feature: null },
  { name: "Kiosk Mode", icon: Monitor, feature: null },
  { name: "Settings", icon: Settings, feature: null },
];

const metricsTemplate = [
  { title: "Total Members", value: "0", change: "+0%", icon: Users, trend: "up" },
  { title: "Live Now", value: "0 Members", change: "Live", icon: Users, trend: "up", isLive: true },
  { title: "Total Revenue", value: "₹0", change: "+0%", icon: TrendingUp, trend: "up" },
  { title: "Active Members", value: "0", change: "+0%", icon: Users, trend: "up" },
  { title: "Pending Dues", value: "₹0", change: "0%", icon: AlertCircle, trend: "down" }
];

function DashboardPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [addMemberTab, setAddMemberTab] = useState("Manual Entry");
  const [isScanQROpen, setIsScanQROpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isTrialExpired, setIsTrialExpired] = useState(false);
  const [isLimitReachedModalOpen, setIsLimitReachedModalOpen] = useState(false);
  const [isProcessingUpgrade, setIsProcessingUpgrade] = useState(false);
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
  const [availablePlans, setAvailablePlans] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [gymSettings, setGymSettings] = useState<any>(null);
  const [showRenewalBanner, setShowRenewalBanner] = useState(false);
  const [daysUntilExpiry, setDaysUntilExpiry] = useState<number | null>(null);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session?.user?.id) {
        setCurrentUserId(session.user.id);
        fetchGymSettings(session.user.id);
      }
    };
    init();
  }, []);

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

  const fetchGymSettings = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("gym_settings")
        .select("*")
        .eq("gym_owner_id", userId)
        .maybeSingle(); // Use maybeSingle to avoid 406/500 if no record exists
      
      if (error) {
        console.error("Database Error (gym_settings):", error);
        return;
      }

      if (data) {
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
        // Fallback: fetch gym name/email from gym_profiles if no settings row yet
        const { data: profileData } = await supabase
          .from("gym_profiles")
          .select("gym_name, email, city")
          .eq("id", userId)
          .maybeSingle();

        setGymSettings({ plan_type: 'Free', ...(profileData ? { gym_name: profileData.gym_name, owner_email: profileData.email, city: profileData.city } : {}) });
      }
    } catch (err) {
      console.error("Critical Exception in fetchGymSettings:", err);
    }
  };

  // New member form state
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberPlan, setNewMemberPlan] = useState("");
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastAddedMember, setLastAddedMember] = useState<any>(null);

  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) {
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
      if (error) throw error;
      
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
  }, [currentUserId]);

  const markNotificationsAsRead = async () => {
    if (!currentUserId) return;
    try {
      const { error } = await supabase
        .from("activity_log")
        .update({ is_read: true })
        .eq("is_read", false)
        .eq('gym_owner_id', currentUserId);

      if (error) throw error;

      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      toast.success("All notifications marked as read");
    } catch (err) {
      console.warn("Error marking notifications as read:", err);
    }
  };

  const fetchAvailablePlans = useCallback(async () => {
    if (!currentUserId) {
      console.error("Dashboard Error: currentUserId is undefined in fetchAvailablePlans");
      return;
    }
    try {
      // First try to fetch from gym_plans
      const { data: plansData, error: plansError } = await supabase
        .from("gym_plans")
        .select("*")
        .eq('gym_owner_id', currentUserId)
        .order("name", { ascending: true });

      console.log("Dashboard Data (Plans):", plansData);
      if (plansError) throw plansError;

      if (plansData && plansData.length > 0) {
        setAvailablePlans(plansData);
      } else {
        // Fallback: Fetch distinct plans from members table if gym_plans is empty
        const { data: membersData, error: membersError } = await supabase
          .from("members")
          .select("membership_plan")
          .eq('gym_owner_id', currentUserId);

        if (membersError) throw membersError;

        const distinctPlans = Array.from(new Set((membersData || [])
          .map(m => m.membership_plan)
          .filter(Boolean)))
          .map(planName => ({
            id: planName,
            name: planName,
            price: 0, // Fallback price
            duration: 1 // Fallback duration
          }));
        
        setAvailablePlans(distinctPlans);
      }
    } catch (err) {
      console.warn("Error fetching plans:", err);
      // Final fallback
      setAvailablePlans([
        { id: 'Monthly', name: 'Monthly', price: 1500, duration: 1 },
        { id: 'Quarterly', name: 'Quarterly', price: 4000, duration: 3 },
        { id: 'Yearly', name: 'Yearly', price: 12000, duration: 12 }
      ]);
    }
  }, [currentUserId]);

  const fetchLiveMemberCount = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from("check_ins")
        .select("*", { count: 'exact', head: true })
        .gte("created_at", twoHoursAgo);

      if (error) throw error;
      setLiveMemberCount(count || 0);
      statsCache.liveMemberCount = count || 0;
    } catch (err) {
      console.warn("Error fetching live member count:", err);
    }
  }, [currentUserId]);

  const fetchMembersCounts = useCallback(async () => {
    if (!currentUserId) {
      console.error("Dashboard Error: currentUserId is undefined in fetchMembersCounts");
      return;
    }
    setIsLoadingStats(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .select("id, status, membership_plan, full_name, mobile_number, expiry_date, amount_paid, created_at")
        .eq('gym_owner_id', currentUserId);

      if (error) {
        console.error("Supabase error fetching members:", error.message);
        toast.error(`Database Error: ${error.message}`);
        return;
      }

      const totalCount = (data || []).length;
      const activeCount = (data || []).filter(m => m.status?.toLowerCase() === 'active').length;

      setTotalMembersCount(totalCount);
      statsCache.totalMembersCount = totalCount;
      setActiveMembersCount(activeCount);
      statsCache.activeMembersCount = activeCount;

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

      (data || []).forEach(m => {
        const paid = Number(m.amount_paid) || 0;
        totalRev += paid;

        const planName = m.membership_plan || 'Monthly';
        const price = planPrices[planName] || 0; // Use 0 if plan not found to avoid fake numbers
        const due = Math.max(0, price - paid);
        totalPending += due;

        // Monthly filtering
        const createdAt = new Date(m.created_at);
        if (createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear) {
          currentMonthRev += paid;
        } else if (createdAt.getMonth() === lastMonth && createdAt.getFullYear() === lastMonthYear) {
          lastMonthRev += paid;
        }

        // Expiry Logic: Check if membership end date has passed today
        if (m.expiry_date && new Date(m.expiry_date) < now && m.status?.toLowerCase() === 'active') {
          expiredMemberIds.push(m.id);
        }
      });

      // Bulk update expired members if any found
      if (expiredMemberIds.length > 0) {
        console.log(`Auto-expiry: Marking ${expiredMemberIds.length} members as Inactive`);
        supabase
          .from("members")
          .update({ status: "Inactive" })
          .in("id", expiredMemberIds)
          .then(({ error }) => {
            if (error) console.error("Auto-expiry update failed:", error);
            else fetchMembersCounts(); // Re-fetch to update UI
          });
      }

      setTotalRevenue(totalRev);
      statsCache.totalRevenue = totalRev;
      setMonthlyRevenue(currentMonthRev);
      setPendingDues(totalPending);

      const change = lastMonthRev === 0 ? (currentMonthRev > 0 ? 100 : 0) : ((currentMonthRev - lastMonthRev) / lastMonthRev) * 100;
      setRevenueChange(change);

      // Update overdue members for 'Action Needed'
      const today = new Date().toISOString();
      const overdue = (data || [])
        .map(m => {
          const paid = Number(m.amount_paid) || 0;
          const planName = m.membership_plan || 'Monthly';
          const price = planPrices[planName] || 0;
          const due = Math.max(0, price - paid);
          
          return {
            name: m.full_name,
            plan: m.membership_plan,
            phone: m.mobile_number,
            expiry_date: m.expiry_date,
            dueAmount: due,
            amount: `₹${due.toLocaleString()}`
          };
        })
        .filter(m => m.dueAmount > 0)
        .sort((a, b) => b.dueAmount - a.dueAmount)
        .slice(0, 5);
        
      setOverdueMembersData(overdue);

    } catch (err: any) {
      console.warn("Error fetching member counts:", err.message);
    } finally {
      setIsLoadingStats(false);
    }
  }, [currentUserId]);




  const fetchRecentActivities = useCallback(async () => {
    if (!currentUserId) {
      console.error("Dashboard Error: currentUserId is undefined in fetchRecentActivities");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("activity_log")
        .select("description, created_at, activity_type")
        .eq('gym_owner_id', currentUserId)
        .order("created_at", { ascending: false })
        .limit(10);
      
      console.log("Dashboard Data (Recent Activities):", data);
      if (error) throw error;
      
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
  }, [currentUserId]);

  const fetchLowStock = useCallback(async () => {
    if (!currentUserId) {
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
      if (error) throw error;
      
      // Map to UI format
      const mappedItems = (data || []).map(item => ({
        name: item.item_name,
        quantity: item.stock_quantity
      }));
      setLowStockItems(mappedItems);
    } catch (err) {
      console.warn("Error fetching low stock:", err);
    }
  }, [currentUserId]);

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
        .insert([{ member_id: memberId, check_in_time: new Date().toISOString() }]);

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

  const startScanner = () => {
    setIsScanQROpen(true);
    toast.info("QR Scanner is temporarily disabled for maintenance.");
  };

  const handleSaveMember = async () => {
    if (!newMemberName || !newMemberPhone || !newMemberPlan) {
      toast.error("Please fill in all fields");
      return;
    }

    // Check for Pro Plan Limits (100 members)
    if (!hasAccess(gymSettings?.plan_type, 'unlimited_members') && totalMembersCount >= LIMITS.FREE_MEMBER_LIMIT) {
      setIsAddMemberOpen(false);
      setIsLimitReachedModalOpen(true);
      return;
    }

    setIsSavingMember(true);
    try {
      const selectedPlan = availablePlans.find(p => p.id === newMemberPlan);
      if (!selectedPlan) throw new Error("Plan not found");

      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + (selectedPlan.duration || 1));

      const { data: newMember, error: insertError } = await supabase
        .from("members")
        .insert([{
          full_name: newMemberName,
          mobile_number: newMemberPhone,
          membership_plan: selectedPlan.name,
          expiry_date: expiryDate.toISOString(),
          status: "Active"
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      // Log activity and record payment
      if (currentUserId) {
        await supabase.from("activity_log").insert([{
          gym_owner_id: currentUserId,
          activity_type: "new_member",
          description: `New member ${newMemberName} joined.`,
          is_read: false
        }]);
      }

      if (selectedPlan.price > 0) {
        await supabase.from("payments").insert([{
          member_id: newMember.id,
          amount: selectedPlan.price,
          status: "Paid",
          payment_date: new Date().toISOString()
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
      
      fetchMembersCounts();
    } catch (error: any) {
      console.warn("Error saving member:", error);
      toast.error("Failed to save member");
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

  const handleSendReminder = async (name: string, phone?: string, amount?: string) => {
    if (!phone) return;

    const n8nWebhookUrl = "https://primary-production-4592.up.railway.app/webhook/gym-reminder"; // Replace with your actual n8n URL
    const cleanPhone = phone.replace(/\D/g, '');
    const reminderId = `${name}-${cleanPhone}`;
    
    setSendingReminderId(reminderId);
    
    try {
      console.log(`n8n: Triggering reminder for ${name}...`);
      
      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          phone: cleanPhone, 
          amount: amount || "pending amount",
          timestamp: new Date().toISOString()
        })
      });

      if (response.ok) {
        toast.success(`Sent ✅ (via Automation)`);
      } else {
        throw new Error("Automation service unavailable");
      }
    } catch (error) {
      console.warn("n8n: Automation failed, falling back to WhatsApp Deep Link", error);
      
      // Fallback to manual WhatsApp link
      const message = `Hello ${name}, your gym fee of ${amount || "pending amount"} is pending. Please clear it soon to avoid any interruption to your access!`;
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
      toast.info(`Automation offline. Opening WhatsApp...`);
    } finally {
      setSendingReminderId(null);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin + "/signup");
    toast.success("Link copied to clipboard");
  };

  const handleUpgradePayment = async () => {
    if (!currentUserId) return;
    
    await initiatePhonePePayment(
      1999,
      currentUserId,
      async () => {
        await finalizePhonePeUpgrade(currentUserId);
        setIsLimitReachedModalOpen(false);
        fetchGymSettings(currentUserId);
      },
      setIsProcessingUpgrade
    );
  };

  useEffect(() => {
    if (currentUserId) {
      fetchMembersCounts();
      fetchRecentActivities();
      fetchLowStock();
      fetchAvailablePlans();
      fetchNotifications();
      fetchLiveMemberCount();

      // Auto-refresh live count every 60 seconds
      const liveRefreshInterval = setInterval(fetchLiveMemberCount, 60000);

      const channel = supabase
        .channel("dashboard_realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `gym_owner_id=eq.${currentUserId}` }, fetchNotifications)
        .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `gym_owner_id=eq.${currentUserId}` }, fetchMembersCounts)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "check_ins" }, fetchLiveMemberCount)
        .subscribe();

      return () => {
        clearInterval(liveRefreshInterval);
        supabase.removeChannel(channel);
      };
    }
  }, [currentUserId, fetchMembersCounts, fetchRecentActivities, fetchLowStock, fetchAvailablePlans, fetchNotifications, fetchLiveMemberCount]);

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
                  <div className="divide-y divide-white/10">
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
                                {member.plan} • <span className="text-red-400 font-medium">{member.amount} Overdue</span>
                              </div>
                            </div>
                          </div>
                          <FeatureLock 
                            planType={gymSettings?.plan_type || 'Free'} 
                            featureName="Automated WhatsApp Reminders"
                          >
                            <Button 
                              onClick={() => handleSendReminder(member.name, member.phone, member.amount)}
                              variant="outline"
                              disabled={(gymSettings && !gymSettings.whatsapp_reminders) || sendingReminderId === `${member.name}-${member.phone?.replace(/\D/g, '')}`}
                              className={`rounded-xl border-white/10 hover:bg-primary hover:text-white ${(gymSettings && !gymSettings.whatsapp_reminders) || sendingReminderId === `${member.name}-${member.phone?.replace(/\D/g, '')}` ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {sendingReminderId === `${member.name}-${member.phone?.replace(/\D/g, '')}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  Send Reminder
                                  <ArrowUpRight className="ml-2 h-4 w-4" />
                                </>
                              )}
                            </Button>
                          </FeatureLock>
                        </div>
                      ))
                    ) : (
                      <div className="p-12 text-center space-y-3">
                        <div className="text-4xl">🎉</div>
                        <p className="text-xl font-bold text-white">All caught up!</p>
                        <p className="text-muted-foreground">No pending dues at the moment.</p>
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
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-6">
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

            <AttendanceHeatmap />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <FeatureLock planType={gymSettings?.plan_type || 'Free'} featureName="AI Retention Engine">
                <RetentionWidget />
              </FeatureLock>
              <FeatureLock planType={gymSettings?.plan_type || 'Free'} featureName="WhatsApp AI Bot">
                <WhatsAppBotWidget />
              </FeatureLock>
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
            <MembersList />
          </motion.div>
        );
      case "Attendance":
        return <AttendanceView />;
      case "Revenue":
        return <RevenueView />;
      case "Inventory":
        return (
          <FeatureLock planType={gymSettings?.plan_type || 'Free'} featureName="Advanced Inventory Manager">
            <InventoryManager />
          </FeatureLock>
        );
      case "Plans":
        return <SettingsView initialCategory="Billing & Plans" />;
      case "Kiosk Mode":
        return <KioskMode />;
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <AnimatePresence>
        {showRenewalBanner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-amber-500 text-white overflow-hidden relative z-[150]"
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
            className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/95 backdrop-blur-xl"
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
            className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-md"
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
              
              <div className="space-y-3">
                <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Limit Reached!</h2>
                <p className="text-slate-500 font-medium">
                  You have reached the <span className="text-slate-900 font-bold">100-member limit</span> for the Free plan. Upgrade to Pro for unlimited members and automated features.
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
                    Upgrade to Pro Now
                  </Button>
                  <div className="flex flex-col gap-3 pt-2">
                    {[
                      { text: "Unlimited members", icon: CheckCircle2 },
                      { text: "Inventory & stock management", icon: CheckCircle2 },
                      { text: "Kiosk mode for check-ins", icon: CheckCircle2 },
                      { text: "Auto WhatsApp reminders", icon: CheckCircle2 }
                    ].map((feat, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm text-slate-600 font-medium justify-center">
                        <feat.icon className="h-4 w-4 text-primary shrink-0" />
                        {feat.text}
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
        
        <nav className="flex-grow px-4 space-y-2">
          {navItems.map((item) => {
            const hasFeatureAccess = hasAccess(gymSettings?.plan_type, item.feature as FeatureName);
            
            return (
              <button
                key={item.name}
                onClick={() => {
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

      <main className="flex-grow relative overflow-y-auto px-6 py-8 md:px-10 lg:py-12">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-brand flex items-center justify-center">
              <span className="font-bold text-white text-xs">G</span>
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Gymphony</span>
          </Link>
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl border-white/10 bg-white/5">
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
                  const hasFeatureAccess = hasAccess(gymSettings?.plan_type, item.feature as FeatureName);
                  return (
                    <button
                      key={item.name}
                      onClick={() => {
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
              </nav>
            </SheetContent>
          </Sheet>
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

            <div className="relative">
              <Button 
                variant="outline" 
                size="icon" 
                className="rounded-full bg-white border border-slate-200 hover:border-primary/30 hover:bg-primary/5 text-slate-600 hover:text-primary transition-all shadow-sm relative group"
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              >
                <Bell className="h-5 w-5 transition-transform group-hover:rotate-12" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 bg-gradient-brand border-2 border-white rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg">
                    {unreadCount}
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
                      className="absolute right-0 mt-4 w-80 bg-white border border-primary/10 rounded-3xl shadow-elegant z-40 overflow-hidden"
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
                      <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                        {notifications.length > 0 ? (
                          notifications.map((n) => (
                            <div key={n.id} className={`p-5 border-b border-slate-50 hover:bg-primary/5 transition-colors ${!n.isRead ? 'bg-primary/[0.02]' : ''}`}>
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

            <div className="relative">
              <button 
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="h-10 w-10 rounded-full bg-gradient-brand p-0.5 transition-transform hover:scale-105"
              >
                <div className="h-full w-full rounded-full bg-slate-950 flex items-center justify-center overflow-hidden">
                  {gymSettings?.logo_url ? (
                    <img src={gymSettings.logo_url} alt="Gym Logo" className="w-full h-full object-cover" />
                  ) : gymSettings?.gym_name ? (
                    <span className="text-white text-xs font-bold">{getGymInitials(gymSettings.gym_name)}</span>
                  ) : (
                    <Users className="h-5 w-5 text-white" />
                  )}
                </div>
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
                        <p className="font-bold text-slate-900 leading-none mb-1">{gymSettings?.gym_name || "Gym Owner"}</p>
                        <p className="text-xs text-slate-500 font-medium">{gymSettings?.owner_email || ""}</p>
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

        {/* Background Gradients */}
        <div className="glow-orb top-0 right-0 h-96 w-96 bg-primary-glow opacity-20" />
        <div className="glow-orb bottom-0 left-1/4 h-80 w-80 bg-primary opacity-10" />

        <div className="relative max-w-7xl mx-auto space-y-10">
          <AnimatePresence>
            {checkedInMember && (
              <motion.div
                initial={{ opacity: 0, y: -50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="fixed top-10 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-6 pointer-events-none"
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

              <div className="flex p-1 bg-slate-100 rounded-2xl">
                {["Manual Entry", "Share QR"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAddMemberTab(tab)}
                    className={`flex-1 py-2 text-sm font-bold rounded-xl transition-all ${
                      addMemberTab === tab ? "bg-white text-primary shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {addMemberTab === "Manual Entry" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-slate-600">Full Name</Label>
                    <Input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} className="bg-slate-50 text-slate-900" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-600">Phone Number</Label>
                    <Input value={newMemberPhone} onChange={(e) => setNewMemberPhone(e.target.value)} className="bg-slate-50 text-slate-900" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-600">Plan</Label>
                    <Select value={newMemberPlan} onValueChange={setNewMemberPlan}>
                      <SelectTrigger className="bg-slate-50 text-slate-900">
                        <SelectValue placeholder="Select plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePlans.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} (₹{p.price})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleSaveMember} disabled={isSavingMember} className="w-full h-12 bg-primary text-white font-bold rounded-xl">
                    {isSavingMember ? "Saving..." : "Save Member"}
                  </Button>
                </div>
              ) : (
                <div className="text-center space-y-6">
                  <div className="mx-auto w-48 h-48 bg-slate-50 rounded-3xl border-2 border-slate-100 flex items-center justify-center p-4">
                    <QrCode className="w-full h-full text-slate-900" />
                  </div>
                  <Button onClick={handleCopyLink} className="w-full h-12 bg-primary/10 text-primary font-bold rounded-xl border border-primary/10">
                    Copy Invite Link
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md" onClick={() => setIsScanQROpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-slate-900 rounded-[2.5rem] p-10 space-y-8 text-center border border-white/10"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold text-white">Scan Member QR</h3>
                <button onClick={() => setIsScanQROpen(false)}><X className="h-6 w-6 text-white/40" /></button>
              </div>
              <div id="reader" className="aspect-square max-w-[280px] mx-auto rounded-3xl overflow-hidden bg-black border-2 border-primary/30"></div>
              <Button onClick={() => setIsScanQROpen(false)} className="w-full h-14 bg-white/10 text-white font-bold rounded-2xl">Close</Button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  </div>
);
}

export default DashboardPage;
