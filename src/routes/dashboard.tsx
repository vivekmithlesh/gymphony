import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Camera,
  Building2,
  Copy,
  CheckCircle2,
  Sparkles,
  Calendar,
  Monitor,
  Clock,
  Package,
} from "lucide-react";
import { USER_ROLES } from "@/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MembersList } from "@/components/MembersList";
import RetentionWidget from "@/components/RetentionWidget";
import WhatsAppBotWidget from "@/components/WhatsAppBotWidget";
import AttendanceHeatmap from "@/components/AttendanceHeatmap";
import { InventoryManager } from "@/components/InventoryManager";
import { RevenueView } from "@/components/RevenueView";
import { SettingsView } from "@/components/SettingsView";
import { AttendanceView } from "@/components/AttendanceView";
import { OwnerInsights } from "@/components/OwnerInsights";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { dashboardSummary } from "@/server/api/dashboard/summary";
import { logoutApi } from "@/server/api/auth/logout";
import { createMemberApi } from "@/server/api/members/create";
import { memberPlans } from "@/server/api/members/plans";
import { joinInviteLink } from "@/server/api/join/invite-link";
import { notificationsUnreadCount } from "@/server/api/notifications/unread-count";
import { notificationsMarkRead } from "@/server/api/notifications/mark-read";
import { getRedirectForRole } from "@/lib/session-redirect";
import { currentSession } from "@/server/api/auth/current-session";
import type {
  DashboardMetric,
  DashboardSummary,
  NotificationItem,
  OverdueMember,
} from "@/types/gym.types";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const session = await currentSession();

    if (!session) {
      throw redirect({ to: "/signup" });
    }

    if (session.role === USER_ROLES.MEMBER) {
      throw redirect({ to: getRedirectForRole(session.role) });
    }
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

const metricIcons = [Users, TrendingUp, Users, AlertCircle] as const;
const notificationIcons = {
  payment: TrendingUp,
  revenue: TrendingUp,
  member: UserPlus,
  attendance: Calendar,
  renewal: TrendingUp,
  expired: AlertCircle,
  staff: Users,
  lead: Sparkles,
  system: Settings,
  overdue: AlertCircle,
  alert: AlertCircle,
  default: Bell,
} as const;

function DashboardPage() {
  return <DashboardPageContent />;
}

function DashboardPageContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [addMemberTab, setAddMemberTab] = useState("Manual Entry");
  const [isScanQROpen, setIsScanQROpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [memberForm, setMemberForm] = useState({
    name: "",
    phone: "",
    planId: "",
    startDate: new Date().toISOString().slice(0, 10),
  });

  const resetMemberForm = () => {
    setMemberForm({
      name: "",
      phone: "",
      planId: "",
      startDate: new Date().toISOString().slice(0, 10),
    });
  };

  const handleLogout = async () => {
    toast.info("Logging out...", {
      position: "bottom-center",
      className: "bg-white text-primary border-primary/20",
    });

    await logoutApi();
    navigate({ to: "/signup" });
  };

  const handleSendReminder = (name: string) => {
    toast.success(`✅ WhatsApp payment link sent to ${name}!`, {
      position: "bottom-center",
      className: "bg-white text-primary border-primary/20",
    });
  };

  const memberPlansQuery = useQuery({
    queryKey: ["member-plans"],
    queryFn: () => memberPlans(),
  });

  const inviteLinkQuery = useQuery({
    queryKey: ["join-invite-link"],
    queryFn: () => joinInviteLink(),
  });

  const unreadCountQuery = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () => notificationsUnreadCount(),
    refetchInterval: 30000,
  });

  const unreadCount = unreadCountQuery.data?.count ?? 0;

  const inviteUrl =
    inviteLinkQuery.data && typeof window !== "undefined"
      ? `${window.location.origin}${inviteLinkQuery.data.joinPath}`
      : "";

  const qrImageUrl = inviteUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(inviteUrl)}`
    : "";

  const openNotifications = async () => {
    const next = !isNotificationsOpen;
    setIsNotificationsOpen(next);

    if (next && unreadCount > 0) {
      try {
        await notificationsMarkRead({ data: {} });
        await queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      } catch {
        // Non-critical: badge will reconcile on next poll.
      }
    }
  };

  const createMemberMutation = useMutation({
    mutationFn: createMemberApi,
    onSuccess: async () => {
      setIsAddMemberOpen(false);
      resetMemberForm();
      await queryClient.invalidateQueries({ queryKey: ["members", 1, 20] });
      toast.success("✅ Member added successfully!", {
        position: "bottom-center",
        className: "bg-white text-primary border-primary/20",
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Unable to add member", {
        position: "bottom-center",
        className: "bg-white text-primary border-primary/20",
      });
    },
  });

  const handleSaveMember = () => {
    createMemberMutation.mutate({
      data: {
        name: memberForm.name.trim(),
        phone: memberForm.phone.replace(/\D/g, "").slice(-10),
        planId: memberForm.planId,
        startDate: memberForm.startDate,
      },
    });
  };

  const handleCopyLink = async () => {
    if (!inviteUrl) {
      toast.error("Invite link is still loading. Please try again.");
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("✅ Invite link copied to clipboard!", {
        position: "bottom-center",
        className: "bg-white text-primary border-primary/20",
      });
    } catch {
      toast.error("Couldn't copy automatically. Link: " + inviteUrl);
    }
  };

  const summaryQuery = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: () => dashboardSummary(),
  });

  const metrics = (summaryQuery.data?.metrics ?? []).map((metric, index) => ({
    ...metric,
    icon: metricIcons[index] ?? Users,
  }));

  const overdueMembers: OverdueMember[] = summaryQuery.data?.overdueMembers ?? [];

  const notifications = (summaryQuery.data?.notifications ?? []).map(
    (notification: NotificationItem) => {
      const normalizedType = notification.type.toLowerCase();

      return {
        ...notification,
        icon:
          notificationIcons[normalizedType as keyof typeof notificationIcons] ??
          notificationIcons.default,
      };
    },
  );
  const activityLog = (summaryQuery.data?.notifications ?? []).map(
    (notification: NotificationItem) => ({
      id: notification.id,
      text: notification.text,
      time: notification.time,
      icon:
        notificationIcons[notification.type as keyof typeof notificationIcons] ??
        notificationIcons.default,
      color: notification.color,
    }),
  );

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Members", icon: Users },
    { name: "Attendance", icon: Calendar },
    { name: "Revenue", icon: TrendingUp },
    { name: "Inventory", icon: Package },
    { name: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* Sidebar (Desktop) */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-white/10 bg-white/5 backdrop-blur-xl">
        <Link to="/" className="p-8 group">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-brand flex items-center justify-center transition-transform group-hover:scale-110">
              <span className="font-bold text-white">G</span>
            </div>
            <span className="font-display text-xl font-bold tracking-tight">Gymphony</span>
          </div>
        </Link>

        <nav className="flex-grow px-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.name}
              onClick={() => setActiveTab(item.name)}
              className={`flex items-center gap-3 px-4 py-3 w-full rounded-xl transition-all ${
                activeTab === item.name
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-white/5"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </button>
          ))}
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
        {/* Mobile Header (Only on small screens) — actions stay reachable on every tab */}
        <div
          className="lg:hidden flex items-center justify-between mb-8 gap-2"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <Link to="/" className="flex items-center gap-2 group">
            <div className="h-8 w-8 rounded-lg bg-gradient-brand flex items-center justify-center transition-transform group-active:scale-95">
              <span className="font-bold text-white text-xs">G</span>
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Gymphony</span>
          </Link>

          <div className="flex items-center gap-2">
            {/* Notifications (mobile) */}
            <div className="relative">
              <Button
                variant="outline"
                size="icon"
                className="rounded-full bg-white/5 border-white/10 hover:bg-white/10 relative h-11 w-11"
                onClick={openNotifications}
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-bold text-white flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
              <AnimatePresence>
                {isNotificationsOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setIsNotificationsOpen(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] z-20 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 backdrop-blur-2xl shadow-2xl"
                    >
                      <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h4 className="font-bold text-sm">Notifications</h4>
                        <Badge className="bg-primary/20 text-primary border-none text-[10px] h-5">
                          {notifications.length}
                        </Badge>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <p className="p-6 text-center text-xs text-muted-foreground">
                            No notifications yet
                          </p>
                        ) : (
                          notifications.map((n) => (
                            <div
                              key={n.id}
                              className="p-4 border-b border-white/5 last:border-none flex gap-3"
                            >
                              <div
                                className={`h-8 w-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 ${n.color}`}
                              >
                                <n.icon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="text-xs font-medium text-white/90 leading-tight">
                                  {n.text}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-1">{n.time}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Profile / Avatar menu (mobile) */}
            <div className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="h-11 w-11 rounded-full bg-gradient-brand p-0.5 active:scale-95 transition-transform"
                aria-label="Account menu"
              >
                <div className="h-full w-full rounded-full bg-background flex items-center justify-center font-bold text-sm">
                  OC
                </div>
              </button>
              <AnimatePresence>
                {isProfileOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsProfileOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-56 z-20 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 backdrop-blur-2xl shadow-2xl p-2"
                    >
                      <button
                        onClick={() => {
                          setActiveTab("Settings");
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/90 hover:bg-white/5 text-left"
                      >
                        <Building2 className="h-4 w-4 text-primary" /> My Gym Profile
                      </button>
                      <button
                        onClick={() => {
                          setActiveTab("Settings");
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/90 hover:bg-white/5 text-left"
                      >
                        <Settings className="h-4 w-4 text-primary" /> Account Settings
                      </button>
                      <button
                        onClick={() => {
                          setActiveTab("Revenue");
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/90 hover:bg-white/5 text-left"
                      >
                        <TrendingUp className="h-4 w-4 text-primary" /> Billing &amp; Revenue
                      </button>
                      <div className="h-px bg-white/10 my-1 mx-2" />
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold text-red-400 hover:bg-red-400/10 text-left"
                      >
                        <LogOut className="h-4 w-4" /> Log Out
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-white/5"
                >
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
                  {navItems.map((item) => (
                    <button
                      key={item.name}
                      onClick={() => {
                        setActiveTab(item.name);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-4 py-3 w-full rounded-xl transition-all ${
                        activeTab === item.name
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.name}
                    </button>
                  ))}
                </nav>

                <div className="absolute bottom-8 left-6 right-6">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <LogOut className="h-5 w-5" />
                    <span className="font-medium">Logout</span>
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Background Gradients */}
        <div className="glow-orb top-0 right-0 h-96 w-96 bg-primary-glow opacity-20" />
        <div className="glow-orb bottom-0 left-1/4 h-80 w-80 bg-primary opacity-10" />

        <div className="relative max-w-7xl mx-auto space-y-10">
          {activeTab === "Dashboard" ? (
            <>
              {/* Header */}
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h1 className="font-display text-3xl font-bold md:text-4xl">
                    Welcome back, <span className="text-gradient-brand">Owner</span>
                  </h1>
                  <p className="mt-1 text-muted-foreground">
                    Here's what's happening at your gym today.
                  </p>
                </div>

                <div className="flex items-center gap-3 relative">
                  <Link to="/kiosk">
                    <Button
                      variant="outline"
                      className="hidden md:flex items-center gap-2 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 transition-all text-sm font-medium"
                    >
                      <Monitor className="h-4 w-4 text-primary" />
                      Launch Kiosk
                    </Button>
                  </Link>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-full bg-white/5 border-white/10 hover:bg-white/10 relative"
                      onClick={openNotifications}
                    >
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-bold text-white flex items-center justify-center">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </Button>

                    <AnimatePresence>
                      {isNotificationsOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setIsNotificationsOpen(false)}
                          />
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 mt-2 w-80 z-20 overflow-hidden rounded-2xl border border-white/10 bg-white/10 backdrop-blur-2xl shadow-2xl"
                          >
                            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                              <h4 className="font-bold text-sm">Notifications</h4>
                              <Badge className="bg-primary/20 text-primary border-none text-[10px] h-5">
                                {notifications.length} New
                              </Badge>
                            </div>
                            <div className="max-h-80 overflow-y-auto">
                              {notifications.map((n) => (
                                <div
                                  key={n.id}
                                  className="p-4 hover:bg-white/5 transition-colors border-b border-white/5 last:border-none flex gap-3 cursor-pointer"
                                >
                                  <div
                                    className={`h-8 w-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 ${n.color}`}
                                  >
                                    <n.icon className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-white/90 leading-tight">
                                      {n.text}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                      {n.time}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <button className="w-full py-3 text-[11px] font-bold text-primary hover:bg-white/5 transition-colors uppercase tracking-wider border-t border-white/10">
                              View All Alerts
                            </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setIsProfileOpen(!isProfileOpen)}
                      className="h-10 w-10 rounded-full bg-gradient-brand p-0.5 transition-transform hover:scale-105 active:scale-95"
                    >
                      <div className="h-full w-full rounded-full bg-background flex items-center justify-center font-bold">
                        OC
                      </div>
                    </button>

                    <AnimatePresence>
                      {isProfileOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setIsProfileOpen(false)}
                          />
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 mt-2 w-56 z-20 overflow-hidden rounded-2xl border border-white/10 bg-white/10 backdrop-blur-2xl shadow-2xl p-2"
                          >
                            <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/90 hover:bg-white/5 transition-colors text-left">
                              <Building2 className="h-4 w-4 text-primary" />
                              My Gym Profile
                            </button>
                            <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/90 hover:bg-white/5 transition-colors text-left">
                              <Settings className="h-4 w-4 text-primary" />
                              Account Settings
                            </button>
                            <div className="h-px bg-white/10 my-1 mx-2" />
                            <button
                              onClick={handleLogout}
                              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold text-red-400 hover:bg-red-400/10 transition-colors text-left"
                            >
                              <LogOut className="h-4 w-4" />
                              Log Out
                            </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </header>

              {/* Quick Actions */}
              <section className="flex flex-wrap items-center gap-4">
                <Button
                  onClick={() => setIsAddMemberOpen(true)}
                  className="h-12 px-6 rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow hover:shadow-primary/40 hover:-translate-y-0.5 transition-all"
                >
                  <Plus className="mr-2 h-5 w-5" />
                  Add Member
                </Button>
                <Button
                  onClick={() => setIsScanQROpen(true)}
                  variant="outline"
                  className="h-12 px-6 rounded-xl border-white/10 bg-white/5 backdrop-blur-xl hover:bg-white/10 font-bold transition-all"
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
                {metrics.map((m, i) => (
                  <motion.div
                    key={m.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Card className="relative overflow-hidden border-white/10 bg-white/5 backdrop-blur-xl group hover:border-primary/30 transition-all">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <m.icon className="h-12 w-12" />
                      </div>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          {m.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold tracking-tight">{m.value}</div>
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
                              <span
                                className={m.trend === "up" ? "text-green-400" : "text-red-400"}
                              >
                                {m.change}
                              </span>
                              <span className="text-muted-foreground">vs last month</span>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </section>

              {/* Owner Insights — business intelligence widgets */}
              <OwnerInsights />

              {/* Action Needed Section */}
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-2xl font-bold flex items-center gap-2">
                      <AlertCircle className="h-6 w-6 text-red-400" />
                      Action Needed
                    </h2>
                    <Button variant="link" className="text-primary p-0">
                      View All
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden shadow-2xl">
                    <div className="divide-y divide-white/10">
                      {overdueMembers.map((member, i) => (
                        <motion.div
                          key={member.name}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                          className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-full bg-red-400/10 flex items-center justify-center">
                              <AlertCircle className="h-6 w-6 text-red-400" />
                            </div>
                            <div>
                              <div className="font-bold text-lg">{member.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {member.plan} •{" "}
                                <span className="text-red-400 font-medium">
                                  {member.amount} Overdue
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right hidden sm:block mr-4">
                              <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                                Overdue By
                              </div>
                              <div className="text-red-400 font-bold">{member.days} Days</div>
                            </div>
                            <Button
                              onClick={() => handleSendReminder(member.name)}
                              className="rounded-xl bg-white/10 border border-white/10 hover:bg-primary hover:text-white transition-all text-primary hover:text-white font-medium px-5"
                            >
                              Send Reminder
                              <ArrowUpRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recent Activity Log */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-2xl font-bold flex items-center gap-2">
                      <Clock className="h-6 w-6 text-primary" />
                      Activity Log
                    </h2>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden shadow-2xl p-6">
                    <div className="space-y-6">
                      {activityLog.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-4">
                          No recent activity
                        </p>
                      ) : (
                        activityLog.map((activity, i) => (
                          <motion.div
                            key={activity.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-xs ${activity.color}`}
                              >
                                <activity.icon className="h-4 w-4" />
                              </div>
                              <div>
                                <div className="text-sm font-bold">{activity.text}</div>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground font-medium">
                              {activity.time}
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>
                    <button className="w-full mt-8 py-3 text-[11px] font-bold text-primary hover:bg-white/5 transition-colors uppercase tracking-widest border-t border-white/10">
                      View Full Log
                    </button>
                  </div>
                </div>
              </section>

              <AttendanceHeatmap />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <RetentionWidget />
                <WhatsAppBotWidget />
              </div>
            </>
          ) : activeTab === "Members" ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h1 className="font-display text-3xl font-bold md:text-4xl">
                    Manage <span className="text-gradient-brand">Members</span>
                  </h1>
                  <p className="mt-1 text-muted-foreground">
                    View and manage your gym's growing community.
                  </p>
                </div>
                <Button
                  onClick={() => setIsAddMemberOpen(true)}
                  className="h-12 px-6 rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow hover:shadow-primary/40 transition-all"
                >
                  <Plus className="mr-2 h-5 w-5" />
                  Add New Member
                </Button>
              </div>
              <MembersList />
            </motion.div>
          ) : activeTab === "Attendance" ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <AttendanceView />
            </motion.div>
          ) : activeTab === "Revenue" ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <RevenueView />
            </motion.div>
          ) : activeTab === "Inventory" ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <InventoryManager />
            </motion.div>
          ) : activeTab === "Settings" ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <SettingsView />
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center py-40 text-center space-y-4">
              <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center text-primary">
                <Users className="h-10 w-10" />
              </div>
              <h2 className="text-3xl font-bold">{activeTab} View Coming Soon</h2>
              <p className="text-muted-foreground max-w-md">
                We're currently building the {activeTab.toLowerCase()} management features. Stay
                tuned!
              </p>
              <Button
                onClick={() => setActiveTab("Dashboard")}
                variant="outline"
                className="rounded-xl border-white/10"
              >
                Back to Dashboard
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isAddMemberOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsAddMemberOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-[2rem] overflow-hidden shadow-2xl"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <UserPlus className="h-5 w-5" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900">Add Member</h3>
                  </div>
                  <button
                    onClick={() => setIsAddMemberOpen(false)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                {/* Tabs Toggle */}
                <div className="flex p-1 bg-slate-100 rounded-2xl">
                  {["Manual Entry", "Share QR"].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setAddMemberTab(tab)}
                      className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
                        addMemberTab === tab
                          ? "bg-white text-primary shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {addMemberTab === "Manual Entry" ? (
                    <motion.div
                      key="manual"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="space-y-4"
                    >
                      <div className="space-y-2">
                        <Label className="text-slate-600 font-medium">Full Name</Label>
                        <Input
                          value={memberForm.name}
                          onChange={(e) =>
                            setMemberForm((current) => ({ ...current, name: e.target.value }))
                          }
                          placeholder="Enter member's name"
                          className="bg-slate-50 border-slate-200 text-slate-900 focus:ring-primary/20 focus:border-primary/50 h-12 rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-600 font-medium">Phone Number</Label>
                        <Input
                          value={memberForm.phone}
                          onChange={(e) =>
                            setMemberForm((current) => ({ ...current, phone: e.target.value }))
                          }
                          placeholder="+91 00000 00000"
                          className="bg-slate-50 border-slate-200 text-slate-900 focus:ring-primary/20 focus:border-primary/50 h-12 rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-600 font-medium">Subscription Plan</Label>
                        <Select
                          value={memberForm.planId}
                          onValueChange={(value) =>
                            setMemberForm((current) => ({ ...current, planId: value }))
                          }
                        >
                          <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 h-12 rounded-xl">
                            <SelectValue placeholder="Select a plan" />
                          </SelectTrigger>
                          <SelectContent className="bg-white border-slate-200">
                            {memberPlansQuery.data?.map((plan) => (
                              <SelectItem key={plan.id} value={plan.id}>
                                {plan.name} ({plan.displayPrice})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-600 font-medium">Start Date</Label>
                        <Input
                          type="date"
                          value={memberForm.startDate}
                          onChange={(e) =>
                            setMemberForm((current) => ({ ...current, startDate: e.target.value }))
                          }
                          className="bg-slate-50 border-slate-200 text-slate-900 focus:ring-primary/20 focus:border-primary/50 h-12 rounded-xl"
                        />
                      </div>

                      <div className="flex gap-3 pt-4">
                        <Button
                          onClick={() => {
                            setIsAddMemberOpen(false);
                            resetMemberForm();
                          }}
                          variant="outline"
                          className="flex-1 h-12 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSaveMember}
                          disabled={
                            createMemberMutation.isPending ||
                            !memberForm.name.trim() ||
                            !memberForm.phone.trim() ||
                            !memberForm.planId ||
                            !memberForm.startDate
                          }
                          className="flex-1 h-12 rounded-xl bg-primary text-white font-bold shadow-lg hover:shadow-primary/30 transition-all"
                        >
                          {createMemberMutation.isPending ? "Saving..." : "Save Member"}
                        </Button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="qr"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="space-y-6 text-center"
                    >
                      <div className="relative mx-auto w-48 h-48 bg-white rounded-3xl border-2 border-slate-100 flex items-center justify-center p-3 overflow-hidden">
                        {qrImageUrl ? (
                          <img
                            src={qrImageUrl}
                            alt="Join gym QR code"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <QrCode className="w-24 h-24 text-slate-300 animate-pulse" />
                        )}
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-bold text-slate-900">
                          Scan to join {inviteLinkQuery.data?.gymName ?? "your gym"}
                        </h4>
                        <p className="text-sm text-slate-500">
                          New members can scan this to sign up &amp; pay instantly
                        </p>
                      </div>

                      <div className="space-y-3 pt-2">
                        <Button
                          onClick={handleCopyLink}
                          className="w-full h-12 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 font-bold transition-all border border-primary/10"
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copy Invite Link
                        </Button>
                        <Button
                          onClick={() => setIsAddMemberOpen(false)}
                          variant="ghost"
                          className="w-full h-12 rounded-xl text-slate-500 font-medium"
                        >
                          Close
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        )}

        {isScanQROpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
            onClick={() => setIsScanQROpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-slate-900 rounded-[2.5rem] overflow-hidden border border-white/10 shadow-2xl"
            >
              <div className="p-10 space-y-8 text-center">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Camera className="h-6 w-6 text-primary" />
                    <h3 className="text-2xl font-bold text-white">Scan Member QR</h3>
                  </div>
                  <button
                    onClick={() => setIsScanQROpen(false)}
                    className="text-white/40 hover:text-white transition-colors"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="relative aspect-square max-w-[280px] mx-auto rounded-3xl overflow-hidden bg-black border-2 border-primary/30">
                  <div className="absolute inset-0 flex items-center justify-center opacity-20">
                    <QrCode className="h-40 w-40 text-white" />
                  </div>
                  {/* Scanning Animation */}
                  <motion.div
                    animate={{ top: ["0%", "100%", "0%"] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="absolute left-0 right-0 h-1 bg-primary shadow-[0_0_15px_var(--primary)] z-10"
                  />
                  {/* Corners */}
                  <div className="absolute top-6 left-6 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                  <div className="absolute top-6 right-6 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                  <div className="absolute bottom-6 left-6 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                  <div className="absolute bottom-6 right-6 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                </div>

                <div className="space-y-4">
                  <p className="text-white/60">
                    Position the QR code within the frame to scan attendance
                  </p>
                  <Button
                    onClick={() => setIsScanQROpen(false)}
                    className="w-full h-14 rounded-2xl bg-white/10 border border-white/10 hover:bg-white/20 text-white font-bold"
                  >
                    Close Scanner
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
