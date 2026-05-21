import { motion } from "framer-motion";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight, 
  DollarSign, 
  Users, 
  CreditCard,
  Download,
  Loader2,
  AlertCircle
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BackButton } from "./BackButton";
import { supabase } from "@/supabase";
import { hasAccess } from "@/lib/permissions";
import { ProtectedProRoute } from "./ProtectedProRoute";
import { Lock, Crown } from "lucide-react";

export function RevenueView() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [payments, setPayments] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [availablePlans, setAvailablePlans] = useState<any[]>([]);
  const [currentGymId, setCurrentGymId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Get user session once on mount
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        setCurrentUserId(session.user.id);
        const { data: gymRow } = await supabase
          .from("gym_settings")
          .select("id")
          .eq("gym_owner_id", session.user.id)
          .maybeSingle();
        setCurrentGymId(gymRow?.id || null);
      }
    };
    getUser();
  }, []);

  const fetchData = useCallback(async (userId: string) => {
    setIsLoading(true);
    console.log('Fetching financial data...');
    try {
      console.log('User found:', userId);

      // Fetch payments and members (essential)
      // verify table name is payments (plural)
      const [paymentsRes, membersRes] = await Promise.all([
        supabase
          .from("payments")
          .select("*")
          .eq("gym_owner_id", userId)
          .order('created_at', { ascending: true }),
        supabase
          .from("members")
          .select("id, status, membership_plan, created_at, joining_date, expiry_date, amount_paid, full_name")
          .eq("gym_owner_id", userId)
      ]);

      const profilesRes = currentGymId
        ? await supabase
            .from("profiles")
            .select("id, status, membership_plan, created_at, joining_date, expiry_date, amount_paid, full_name, gym_id")
            .eq("gym_id", currentGymId)
        : { data: [], error: null as any };

      if (paymentsRes.error) {
        console.error('Financial Fetch Error (payments):', paymentsRes.error);
        // We log the error clearly for the user to see in the console
      } else {
        console.log('Payments data received:', paymentsRes.data?.length || 0, 'rows');
        setPayments(paymentsRes.data || []);
      }

      if (membersRes.error) {
        console.error('Financial Fetch Error (members):', membersRes.error);
        toast.error(`Database Error: ${membersRes.error.message}`);
        setMembers([]);
      } else {
        console.log('Members data received:', membersRes.data?.length || 0, 'rows');
        setMembers(membersRes.data || []);
      }

      if (profilesRes.error) {
        console.error('Financial Fetch Error (profiles):', profilesRes.error);
        setProfiles([]);
      } else {
        setProfiles(profilesRes.data || []);
      }

      // Fetch expenses (optional - might not exist yet)
      try {
        const { data: expensesData, error: expensesError } = await supabase
          .from("expenses")
          .select("*")
          .eq("gym_owner_id", userId);
        
        if (!expensesError) {
          console.log('Expenses data received:', expensesData?.length || 0, 'rows');
          setExpenses(expensesData || []);
        } else {
          console.warn("Expenses table might not exist or is inaccessible:", expensesError.message);
          setExpenses([]);
        }
      } catch (e) {
        console.warn("Silent error fetching expenses:", e);
        setExpenses([]);
      }

      // Fetch available plans
      const fetchPlansForGym = async () => {
        if (!currentGymId) return [];

        const { data: membershipPlans, error: membershipPlansError } = await supabase
          .from("membership_plans")
          .select("*")
          .order("name", { ascending: true });

        if (!membershipPlansError && membershipPlans) {
          return membershipPlans.filter((plan) => String(plan.gym_id) === String(currentGymId));
        }

        return [];
      };

      setAvailablePlans(await fetchPlansForGym());

    } catch (error: any) {
      console.error("Financial Fetch Error (Global):", error);
      toast.error(`Failed to load financial data: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentGymId]);

  useEffect(() => {
    if (currentUserId && currentGymId) {
      fetchData(currentUserId);
    }
  }, [currentUserId, currentGymId, fetchData]);

  useEffect(() => {
    if (currentUserId) {
      fetchData(currentUserId);

      // Set up realtime subscription
      const revenueChannel = supabase
        .channel("revenue_view_realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => fetchData(currentUserId))
        .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => fetchData(currentUserId))
        .on("postgres_changes", { event: "*", schema: "public", table: "membership_plans" }, () => fetchData(currentUserId))
        .subscribe();

      return () => {
        supabase.removeChannel(revenueChannel);
      };
    }
  }, [currentUserId, fetchData]);

  const metrics = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    // Use payments table for revenue if available, fallback to members table
    const usePaymentsTable = payments.length > 0;

    const currentMonthPayments = payments.filter(p => {
      const d = new Date(p.created_at);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const lastMonthPayments = payments.filter(p => {
      const d = new Date(p.created_at);
      return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
    });

    const currentMonthMembers = members.filter(m => {
      const d = new Date(m.created_at);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const lastMonthMembers = members.filter(m => {
      const d = new Date(m.created_at);
      return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
    });

    const currentRevenue = usePaymentsTable 
      ? currentMonthPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
      : currentMonthMembers.reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0);

    const lastRevenue = usePaymentsTable
      ? lastMonthPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
      : lastMonthMembers.reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0);
    
    const revenueChange = lastRevenue === 0 ? 100 : ((currentRevenue - lastRevenue) / lastRevenue) * 100;

    const activeMembers = members.filter(m => (m.status || '').toLowerCase() === 'active');
    const avgPerMember = activeMembers.length > 0 ? currentRevenue / activeMembers.length : 0;
    
    // Previous avg per member for trend
    const lastActiveMembersCount = Math.max(lastMonthMembers.length, 1);
    const lastAvgPerMember = lastRevenue / lastActiveMembersCount;
    const avgChange = lastAvgPerMember === 0 ? 100 : ((avgPerMember - lastAvgPerMember) / lastAvgPerMember) * 100;

    const totalRevenue = usePaymentsTable
      ? payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
      : members.reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0);

    // Expenses calculation
    const totalExpenses = expenses.length > 0 
      ? expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
      : totalRevenue * 0.2; // 20% placeholder if no expenses table

    const netProfit = totalRevenue - totalExpenses;

    const expiredThisMonth = members.filter(m => {
      if ((m.status || '').toLowerCase() !== 'expired') return false;
      const d = new Date(m.expiry_date || m.created_at);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length;

    const churnRate = members.length > 0 ? (expiredThisMonth / members.length) * 100 : 0;

    return [
      { 
        title: "Total Revenue", 
        value: `₹${totalRevenue.toLocaleString()}`, 
        change: `${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}%`, 
        trend: revenueChange >= 0 ? "up" : "down", 
        icon: DollarSign 
      },
      { 
        title: "Monthly Revenue", 
        value: `₹${currentRevenue.toLocaleString()}`, 
        change: `${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}%`, 
        trend: revenueChange >= 0 ? "up" : "down", 
        icon: TrendingUp 
      },
      { 
        title: "Net Profit", 
        value: `₹${Math.round(netProfit).toLocaleString()}`, 
        change: "+8.1%", 
        trend: "up", 
        icon: TrendingUp 
      },
      { 
        title: "Churn Rate", 
        value: `${churnRate.toFixed(1)}%`, 
        change: "-0.5%", 
        trend: "down", 
        icon: CreditCard 
      },
    ];
  }, [members, payments, expenses]);

  const revenueChartData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const last6Months = [];
    const now = new Date();
    const usePaymentsTable = payments.length > 0;
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthIndex = d.getMonth();
      const year = d.getFullYear();
      const monthLabel = months[monthIndex];
      
      let amount = 0;
      if (usePaymentsTable) {
        const monthPayments = payments.filter(p => {
          const pd = new Date(p.created_at);
          return pd.getMonth() === monthIndex && pd.getFullYear() === year;
        });
        amount = monthPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      } else {
        const monthMembers = members.filter(m => {
          const md = new Date(m.created_at);
          return md.getMonth() === monthIndex && md.getFullYear() === year;
        });
        amount = monthMembers.reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0);
      }
      
      last6Months.push({ month: monthLabel, amount });
    }
    return last6Months;
  }, [members, payments]);

  const planDistribution = useMemo(() => {
    const colors = ['#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#94a3b8', '#10b981', '#f59e0b'];
    const planNames = Array.from(new Set([
      ...availablePlans.map((plan) => plan.name || plan.plan_name).filter(Boolean),
      ...profiles.map((profile) => profile.membership_plan).filter(Boolean),
    ]));

    return planNames.map((planName, i) => {
      const count = profiles.filter(profile => profile.membership_plan === planName).length;
      return {
        name: planName,
        count,
        color: colors[i % colors.length]
      };
    }).sort((a, b) => b.count - a.count);
  }, [profiles, availablePlans]);

  const handleExport = () => {
    const usePaymentsTable = payments.length > 0;
    const dataToExport = usePaymentsTable ? payments : members;
    
    if (dataToExport.length === 0) {
      console.log("No financial data to export");
      toast.error("No data available to export");
      return;
    }

    const headers = usePaymentsTable 
      ? ["Date", "Payment ID", "Amount", "Status", "Payment Method"]
      : ["Date", "Member Name", "Plan", "Amount Paid", "Status"];

    const csvContent = [
      headers.join(","),
      ...dataToExport.map(item => {
        if (usePaymentsTable) {
          return [
            new Date(item.created_at).toLocaleDateString(),
            item.id,
            item.amount || 0,
            item.status || 'Success',
            item.payment_method || 'N/A'
          ].join(",");
        } else {
          return [
            new Date(item.created_at).toLocaleDateString(),
            item.full_name || 'N/A',
            item.membership_plan || 'N/A',
            item.amount_paid || 0,
            item.status || 'Active'
          ].join(",");
        }
      })
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `revenue_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success("✅ Financial report exported as CSV!", {
      position: "bottom-center",
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-100 space-y-4">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-muted-foreground animate-pulse">Calculating financial metrics...</p>
      </div>
    );
  }

  return (
    <ProtectedProRoute 
      featureName="Advanced Analytics" 
      description="Upgrade to Pro to unlock deep insights, monthly growth trends, and detailed membership distribution."
    >
      <div className="space-y-8 pb-10">
        <div className="mb-2">
          <BackButton />
        </div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="font-display text-3xl font-bold md:text-4xl">
              Revenue <span className="text-gradient-brand">Analytics</span>
            </h1>
            <p className="mt-1 text-muted-foreground">
              Track your gym's financial growth and membership performance.
            </p>
          </div>
          <Button 
            onClick={handleExport}
            variant="outline" 
            className="rounded-xl border-primary/20 bg-white shadow-soft hover:bg-primary/5 text-primary font-bold transition-all"
          >
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="border-border bg-white shadow-soft hover:shadow-elegant transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{item.title}</CardTitle>
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <item.icon className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">{item.value}</div>
                  <div className={`mt-1 flex items-center gap-1 text-xs font-bold ${item.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                    {item.trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {item.change}
                    <span className="text-muted-foreground font-medium ml-1">vs last month</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Revenue Chart */}
          <Card className="lg:col-span-2 border-border bg-white shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900">Revenue Growth</CardTitle>
            </CardHeader>
            <CardContent className="h-87.5 w-full pr-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueChartData}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7B2CFF" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#7B2CFF" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis 
                    dataKey="month" 
                    stroke="#94a3b8" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    dy={10}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(value) => `₹${value/1000}k`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: '12px',
                      fontSize: '12px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                    }}
                    itemStyle={{ color: '#7B2CFF', fontWeight: 'bold' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="amount" 
                    stroke="#7B2CFF" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                    animationDuration={1500}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Plan Distribution */}
          <Card className="border-border bg-white shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900">Membership Plans</CardTitle>
            </CardHeader>
            <CardContent className="h-87.5 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={planDistribution} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#94a3b8" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    dy={10}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: '12px',
                      fontSize: '12px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                    }}
                    cursor={{ fill: '#7B2CFF05' }}
                  />
                  <Bar 
                    dataKey="count" 
                    radius={[10, 10, 0, 0]} 
                    barSize={40}
                  >
                    {planDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </ProtectedProRoute>
  );
}

