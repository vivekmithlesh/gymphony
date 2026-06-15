import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { usePlanAccess } from "@/lib/usePlanAccess";
import { type AppFeature } from "@/lib/plans";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  Calendar,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Package,
  Settings,
  Trophy,
  TrendingUp,
  Users,
  Lock,
} from "lucide-react";
import { supabase } from "@/supabase";

type NavItem = {
  name: string;
  icon: typeof LayoutDashboard;
  /** Central app feature this item is gated behind (null = always allowed). */
  feature: AppFeature | null;
  to?: string;
};

const navItems: NavItem[] = [
  { name: "Dashboard", icon: LayoutDashboard, feature: null },
  { name: "Members", icon: Users, feature: null },
  { name: "Attendance", icon: Calendar, feature: null },
  { name: "Revenue", icon: TrendingUp, feature: "revenue_analytics" },
  { name: "🏆 Leaderboard", icon: Trophy, feature: "leaderboard", to: "/city-leaderboard" },
  { name: "Inventory", icon: Package, feature: "inventory_management" },
  { name: "Plans", icon: CreditCard, feature: null },
  { name: "Kiosk Mode", icon: Monitor, feature: null },
  { name: "Settings", icon: Settings, feature: null },
];

type DashboardLayoutProps = {
  children: React.ReactNode;
  activeTab?: string;
};

export function DashboardLayout({ children, activeTab = "🏆 Leaderboard" }: DashboardLayoutProps) {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { hasAccess, requiredTierFor } = usePlanAccess();
  const [upgrade, setUpgrade] = useState<{ tier: ReturnType<typeof requiredTierFor>; label: string } | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  const handleNav = (itemName: string, to?: string) => {
    if (to) {
      navigate({ to: to as "/city-leaderboard" });
      return;
    }

    navigate({
      to: "/dashboard",
      search: { tab: itemName } as any,
    });
  };

  const renderNav = (mobile: boolean) => (
    <nav className={mobile ? "space-y-2" : "grow px-4 space-y-2"}>
      {navItems.map((item) => {
        const hasFeatureAccess = item.feature ? hasAccess(item.feature) : true;
        const isActive = activeTab === item.name;

        return (
          <button
            key={item.name}
            onClick={() => {
              // Locked feature → open the Upgrade modal instead of navigating.
              if (item.feature && !hasFeatureAccess) {
                setUpgrade({ tier: requiredTierFor(item.feature), label: item.name.replace(/^🏆\s*/, "") });
                if (mobile) setIsMobileMenuOpen(false);
                return;
              }
              handleNav(item.name, item.to);
              if (mobile) {
                setIsMobileMenuOpen(false);
              }
            }}
            className={`flex w-full items-center justify-between rounded-xl px-4 py-3 transition-all ${
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5" />
              <span className="text-sm">{item.name}</span>
            </div>
            {!hasFeatureAccess && <Lock className="h-3 w-3 opacity-50" />}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-[#F9FAFB] text-foreground">
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white/80 backdrop-blur-xl lg:flex">
        <Link to="/" className="group p-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand transition-transform group-hover:scale-110">
              <span className="font-bold text-white">G</span>
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-foreground">Gymphony</span>
          </div>
        </Link>

        {renderNav(false)}

        <div className="mt-auto p-6">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground transition-colors hover:bg-red-400/10 hover:text-red-400"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </aside>

      <main className="relative grow overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-12">
        <div className="mb-8 flex items-center justify-between lg:hidden">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand">
              <span className="text-xs font-bold text-white">G</span>
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-foreground">Gymphony</span>
          </Link>

          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl border-slate-200 bg-white">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-slate-200 bg-white text-foreground">
              <SheetHeader className="mb-8 px-2 text-left">
                <SheetTitle className="flex items-center gap-2 text-foreground">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand">
                    <span className="text-xs font-bold text-white">G</span>
                  </div>
                  Gymphony
                </SheetTitle>
              </SheetHeader>
              {renderNav(true)}
              <div className="mt-6 px-2">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground transition-colors hover:bg-red-400/10 hover:text-red-400"
                >
                  <LogOut className="h-5 w-5" />
                  Logout
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {children}
      </main>

      {upgrade && (
        <UpgradeModal
          open={!!upgrade}
          onClose={() => setUpgrade(null)}
          requiredTier={upgrade.tier}
          featureLabel={upgrade.label}
        />
      )}
    </div>
  );
}