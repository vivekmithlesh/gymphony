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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { BackButton } from "./BackButton";
import { supabase } from "@/supabase";
import { hasAccess } from "@/lib/permissions";
import { isApprovedPayment } from "@/lib/revenue";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth-context";
import { ProtectedProRoute } from "./ProtectedProRoute";
import { PaymentLedger } from "./PaymentLedger";
import { Lock, Crown } from "lucide-react";

export function RevenueView() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [payments, setPayments] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [availablePlans, setAvailablePlans] = useState<any[]>([]);
  const [currentGymId, setCurrentGymId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string>("");
  // The gym's registration timestamp — drives the "before registration" months
  // in the Revenue Growth chart.
  const [gymCreatedAt, setGymCreatedAt] = useState<string | null>(null);
  // Year currently selected in the Revenue Growth chart (defaults to this year).
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const { user } = useAuth();

  // Resolve the owner + their gym from the global auth state.
  useEffect(() => {
    const loadGym = async () => {
      if (!user?.id) return;
      setCurrentUserId(user.id);
      const { data: gymRow } = await supabase
        .from("gym_settings")
        .select("id, gym_name, created_at")
        .eq("gym_owner_id", user.id)
        .maybeSingle();
      setCurrentGymId(gymRow?.id || null);
      setGymName(gymRow?.gym_name || "");
      setGymCreatedAt(gymRow?.created_at ?? null);
    };
    loadGym();
  }, [user?.id]);

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

  // Single source of truth: fetch once the owner is known, refetch when the gym
  // id resolves (fetchData closes over currentGymId), and keep metrics live via
  // realtime — scoped to THIS owner/gym so other gyms' writes don't trigger
  // needless refetches.
  useEffect(() => {
    if (!currentUserId) return;

    fetchData(currentUserId);

    // fetchData re-reads the WHOLE payments ledger + members + profiles, so a
    // burst of realtime events (payment batch, bulk member import) must not run
    // it once per event. Coalesce into a single trailing refetch.
    const debouncedRefetch = debounce(() => fetchData(currentUserId), 400);

    const revenueChannel = supabase
      .channel("revenue_view_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `gym_owner_id=eq.${currentUserId}` },
        debouncedRefetch
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "members", filter: `gym_owner_id=eq.${currentUserId}` },
        debouncedRefetch
      )
      .on(
        "postgres_changes",
        currentGymId
          ? { event: "*", schema: "public", table: "membership_plans", filter: `gym_id=eq.${currentGymId}` }
          : { event: "*", schema: "public", table: "membership_plans" },
        debouncedRefetch
      )
      .subscribe();

    return () => {
      debouncedRefetch.cancel();
      supabase.removeChannel(revenueChannel);
    };
  }, [currentUserId, currentGymId, fetchData]);

  const metrics = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    // Revenue counts ONLY approved payments (Paid/Success) — pending_verification
    // and rejected rows must never inflate the cards or chart. See lib/revenue.ts.
    const approvedPayments = payments.filter(p => isApprovedPayment(p.status));

    // Use payments table for revenue if available, fallback to members table
    const usePaymentsTable = approvedPayments.length > 0;

    const currentMonthPayments = approvedPayments.filter(p => {
      const d = new Date(p.created_at);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const lastMonthPayments = approvedPayments.filter(p => {
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
      ? approvedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
      : members.reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0);

    // 0% platform fee — the gym owner keeps 100% of what members pay, so Net
    // Profit is identical to Total Revenue (no deductions).
    const netProfit = totalRevenue;

    // ── Churn rate ────────────────────────────────────────────────────────────
    // Churn = (members who lapsed this month) / (members active at the start of
    // the month) * 100. We only have a status snapshot (no status_changed_at
    // column), so we proxy "lapsed this month" with the expiry_date and "active
    // at start of month" with the join/created date. Documented approximation.
    const lapsedStatuses = ["inactive", "cancelled", "canceled", "expired"];
    const isLapsed = (status?: string) => lapsedStatuses.includes((status || "").toLowerCase());

    const lapsedInMonth = (monthIdx: number, yearVal: number) =>
      members.filter((m) => {
        if (!isLapsed(m.status)) return false;
        const d = new Date(m.expiry_date || m.updated_at || m.created_at);
        return !isNaN(d.getTime()) && d.getMonth() === monthIdx && d.getFullYear() === yearVal;
      });

    // Members who existed before the given month started AND were either still
    // active or churned during that month = the active base at the month's start.
    const activeAtStartOf = (monthIdx: number, yearVal: number, lapsedSet: any[]) => {
      const start = new Date(yearVal, monthIdx, 1).getTime();
      return members.filter((m) => {
        const created = new Date(m.joining_date || m.created_at);
        if (isNaN(created.getTime()) || created.getTime() >= start) return false;
        return (m.status || "").toLowerCase() === "active" || lapsedSet.includes(m);
      }).length;
    };

    const cancelledThisMonth = lapsedInMonth(currentMonth, currentYear);
    const activeAtStart = activeAtStartOf(currentMonth, currentYear, cancelledThisMonth);
    const churnRate = activeAtStart > 0 ? (cancelledThisMonth.length / activeAtStart) * 100 : 0;

    const cancelledLastMonth = lapsedInMonth(lastMonth, lastMonthYear);
    const activeAtLastStart = activeAtStartOf(lastMonth, lastMonthYear, cancelledLastMonth);
    const lastChurnRate = activeAtLastStart > 0 ? (cancelledLastMonth.length / activeAtLastStart) * 100 : 0;

    const churnChange = churnRate - lastChurnRate; // percentage points

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
        // Net Profit mirrors Total Revenue under the 0% fee model.
        title: "Net Profit",
        value: `₹${Math.round(netProfit).toLocaleString()}`,
        change: `${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}%`,
        trend: revenueChange >= 0 ? "up" : "down",
        icon: TrendingUp
      },
      {
        title: "Churn Rate",
        value: `${churnRate.toFixed(1)}%`,
        // Rising churn is bad (red/down); falling churn is good (green/up).
        change: `${churnChange >= 0 ? '+' : ''}${churnChange.toFixed(1)}%`,
        trend: churnChange > 0 ? "down" : "up",
        icon: CreditCard
      },
    ];
  }, [members, payments]);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Years offered in the selector: gym-registration year → current year (desc).
  // Falls back to the last two years if the registration date is unavailable.
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const regDate = gymCreatedAt ? new Date(gymCreatedAt) : null;
    const startYear =
      regDate && !isNaN(regDate.getTime()) ? regDate.getFullYear() : currentYear - 1;
    const years: number[] = [];
    for (let y = currentYear; y >= startYear; y--) years.push(y);
    return years.length ? years : [currentYear];
  }, [gymCreatedAt]);

  // 12-month revenue series for the selected year. Months before the gym's
  // registration month (in the registration year) are emitted with revenue=null
  // so the area starts plotting from the registration month; their tooltip shows
  // a "registered since" note instead.
  const revenueChartData = useMemo(() => {
    // Chart plots realized revenue only — same approved-payment rule as the cards.
    const approvedPayments = payments.filter(p => isApprovedPayment(p.status));
    const usePaymentsTable = approvedPayments.length > 0;

    const regDate = gymCreatedAt ? new Date(gymCreatedAt) : null;
    const hasReg = regDate != null && !isNaN(regDate.getTime());
    const regYear = hasReg ? regDate!.getFullYear() : null;
    const regMonth = hasReg ? regDate!.getMonth() : null;
    const registeredLabel = hasReg
      ? regDate!.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      : "";

    return MONTHS.map((monthLabel, monthIndex) => {
      const beforeRegistration =
        regYear != null && selectedYear === regYear && monthIndex < (regMonth as number);

      let amount = 0;
      if (usePaymentsTable) {
        amount = approvedPayments
          .filter((p) => {
            const pd = new Date(p.created_at);
            return pd.getMonth() === monthIndex && pd.getFullYear() === selectedYear;
          })
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      } else {
        amount = members
          .filter((m) => {
            const md = new Date(m.created_at);
            return md.getMonth() === monthIndex && md.getFullYear() === selectedYear;
          })
          .reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0);
      }

      return {
        month: monthLabel,
        // null (not 0) before registration so the line/area leaves a gap there.
        revenue: beforeRegistration ? null : amount,
        beforeRegistration,
        registeredLabel,
      };
    });
  }, [members, payments, selectedYear, gymCreatedAt]);

  // Active-member distribution across membership plans (count + % share).
  const planDistribution = useMemo(() => {
    const colors = ['#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#94a3b8', '#10b981', '#f59e0b'];

    const activeMembers = members.filter((m) => (m.status || '').toLowerCase() === 'active');
    const totalActive = activeMembers.length;

    const counts = new Map<string, number>();
    activeMembers.forEach((m) => {
      const plan = (m.membership_plan && String(m.membership_plan).trim()) || 'Unassigned';
      counts.set(plan, (counts.get(plan) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([name, count], i) => ({
        name,
        count,
        percentage: totalActive > 0 ? Math.round((count / totalActive) * 100) : 0,
        color: colors[i % colors.length],
      }))
      .sort((a, b) => b.count - a.count);
  }, [members]);

  // member_id -> name, reusing data already in state (no extra query).
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => { if (m.id) map.set(m.id, m.full_name || ""); });
    profiles.forEach((p) => { if (p.id && !map.has(p.id)) map.set(p.id, p.full_name || ""); });
    return map;
  }, [members, profiles]);

  // Recent payments ledger (all statuses) for the owner — built from the
  // already-fetched, realtime `payments` state.
  const recentTransactions = useMemo(() => {
    const ts = (p: any) => new Date(p.payment_date || p.created_at || 0).getTime();
    return [...payments]
      .sort((a, b) => ts(b) - ts(a))
      .slice(0, 15)
      .map((p) => ({
        id: p.id,
        name: memberNameById.get(p.member_id) || "Member",
        amount: Number(p.amount) || 0,
        status: String(p.status || "Success"),
        method: p.payment_method || "—",
        plan: p.plan_name || "Membership",
        date: p.payment_date || p.created_at,
      }));
  }, [payments, memberNameById]);

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (isExporting) return;
    // The report is a realized-revenue ledger: only approved (Paid/Success)
    // payments are exported, so the rows sum to the "Total Revenue" totals line.
    const approvedPayments = payments.filter((p) => isApprovedPayment(p.status));
    const usePaymentsTable = approvedPayments.length > 0;

    // The payments table only stores member_id (schema: id, member_id, amount,
    // payment_method, status, created_at, gym_owner_id) — no name column. So we
    // resolve the member's name from the already-loaded members list (falling
    // back to profiles). No extra query needed.
    const memberNameById = new Map<string, string>();
    members.forEach((m) => { if (m.id) memberNameById.set(String(m.id), m.full_name || ""); });
    profiles.forEach((p) => {
      if (p.id && !memberNameById.has(String(p.id))) memberNameById.set(String(p.id), p.full_name || "");
    });

    // Format a date as a clean, human-readable string (e.g. "03 Jun 2026").
    const formatDate = (value: unknown) => {
      if (!value) return "";
      const d = new Date(value as string);
      return isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    };

    // Build typed rows — Amount Paid stays a real JS number so Excel treats the
    // column as numeric; Date/Status are strings.
    type ExportRow = { Date: string; "Member Name": string; "Amount Paid": number; Status: string };
    const rows: ExportRow[] = usePaymentsTable
      ? approvedPayments.map((p) => ({
          Date: formatDate(p.created_at),
          "Member Name": memberNameById.get(String(p.member_id)) || "Unknown Member",
          "Amount Paid": Number(p.amount) || 0,
          Status: p.status || "Success",
        }))
      : members.map((m) => ({
          Date: formatDate(m.created_at),
          "Member Name": m.full_name || "Unknown Member",
          "Amount Paid": Number(m.amount_paid) || 0,
          Status: m.status || "Active",
        }));

    if (rows.length === 0) {
      toast.error("No revenue data available to export yet.");
      return;
    }

    setIsExporting(true);
    try {
      // xlsx-js-style is a drop-in fork of SheetJS that also writes cell styles
      // (font, fill, border) via the cell `.s` property. Dynamic import keeps it
      // out of the initial bundle.
      const XLSX = await import("xlsx-js-style");

      const header = ["Date", "Member Name", "Amount Paid", "Status"];
      const totalAmount = rows.reduce((sum, r) => sum + (Number(r["Amount Paid"]) || 0), 0);
      const generatedOn = new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

      // Layout (0-based rows):
      //   0  Title banner        (merged A1:D1)
      //   1  Subtitle / date     (merged A2:D2)
      //   2  Column header        (A3:D3)
      //   3… Data rows
      //   N  Totals row
      const TITLE_ROW = 0;
      const SUBTITLE_ROW = 1;
      const HEADER_ROW = 2;
      const FIRST_DATA_ROW = 3;
      const TOTALS_ROW = FIRST_DATA_ROW + rows.length;
      const LAST_COL = header.length - 1; // D

      // Start with the two banner rows, then drop the table in beneath them and
      // append a totals row.
      const ws = XLSX.utils.aoa_to_sheet([
        [gymName || "Revenue Report"],
        [`Revenue Report  ·  Generated ${generatedOn}`],
      ]);
      XLSX.utils.sheet_add_json(ws, rows, { header, origin: `A${HEADER_ROW + 1}` });
      XLSX.utils.sheet_add_aoa(ws, [["", "Total Revenue", totalAmount, ""]], {
        origin: { r: TOTALS_ROW, c: 0 },
      });

      // Column widths + tuned heights for the banner/header rows.
      ws["!cols"] = [{ wch: 18 }, { wch: 30 }, { wch: 18 }, { wch: 14 }];
      ws["!rows"] = [{ hpt: 30 }, { hpt: 18 }, { hpt: 22 }];
      ws["!merges"] = [
        { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: LAST_COL } },
        { s: { r: SUBTITLE_ROW, c: 0 }, e: { r: SUBTITLE_ROW, c: LAST_COL } },
      ];
      // Autofilter spans the header + data rows only.
      ws["!autofilter"] = { ref: `A${HEADER_ROW + 1}:D${TOTALS_ROW}` };

      // ── Styling ───────────────────────────────────────────────────────────
      const thin = { style: "thin", color: { rgb: "E2E8F0" } };
      const border = { top: thin, bottom: thin, left: thin, right: thin };
      const amountFmt = "₹#,##0.00";

      const styleCell = (r: number, c: number, s: Record<string, unknown>) => {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = s;
        return cell;
      };

      // Title banner — large bold white on brand purple.
      styleCell(TITLE_ROW, 0, {
        font: { bold: true, sz: 18, color: { rgb: "FFFFFF" }, name: "Calibri" },
        fill: { fgColor: { rgb: "7B2CFF" } },
        alignment: { horizontal: "center", vertical: "center" },
      });
      // Subtitle — muted, italic.
      styleCell(SUBTITLE_ROW, 0, {
        font: { italic: true, sz: 11, color: { rgb: "64748B" }, name: "Calibri" },
        fill: { fgColor: { rgb: "F5F3FB" } },
        alignment: { horizontal: "center", vertical: "center" },
      });

      // Column header — bold white on a slightly darker purple.
      const headerStyle = {
        font: { bold: true, sz: 12, color: { rgb: "FFFFFF" }, name: "Calibri" },
        fill: { fgColor: { rgb: "6D28D9" } },
        alignment: { horizontal: "center", vertical: "center" },
        border,
      };
      for (let c = 0; c <= LAST_COL; c++) styleCell(HEADER_ROW, c, headerStyle);

      // Data rows — zebra striping, borders, amounts right-aligned and numeric.
      for (let r = FIRST_DATA_ROW; r < TOTALS_ROW; r++) {
        const stripe = (r - FIRST_DATA_ROW) % 2 === 0 ? "FFFFFF" : "F5F3FB";
        for (let c = 0; c <= LAST_COL; c++) {
          const isAmount = c === 2;
          const cell = styleCell(r, c, {
            font: { sz: 11, color: { rgb: "1E293B" }, name: "Calibri" },
            fill: { fgColor: { rgb: stripe } },
            alignment: { horizontal: isAmount ? "right" : "left", vertical: "center" },
            border,
          });
          if (cell && isAmount) {
            cell.t = "n";
            cell.z = amountFmt;
          }
        }
      }

      // Totals row — bold, top-bordered, summed revenue as a real number.
      const totalsBorder = { top: { style: "medium", color: { rgb: "7B2CFF" } }, bottom: thin };
      for (let c = 0; c <= LAST_COL; c++) {
        const isAmount = c === 2;
        const cell = styleCell(TOTALS_ROW, c, {
          font: { bold: true, sz: 12, color: { rgb: "111827" }, name: "Calibri" },
          fill: { fgColor: { rgb: "EDE9FE" } },
          alignment: { horizontal: isAmount ? "right" : c === 1 ? "right" : "left", vertical: "center" },
          border: totalsBorder,
        });
        if (cell && isAmount) {
          cell.t = "n";
          cell.z = amountFmt;
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Revenue Report");

      // writeFile builds the .xlsx and triggers the browser download directly.
      XLSX.writeFile(wb, "revenue_report.xlsx", { compression: true });

      toast.success("Revenue report exported as Excel (.xlsx).", { position: "bottom-center" });
    } catch (err) {
      console.error("Excel export failed:", err);
      toast.error("Could not generate the Excel file. Please try again.");
    } finally {
      setIsExporting(false);
    }
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
      feature="revenue_analytics"
      featureName="Revenue Analytics"
      description="Revenue analytics is a Growth feature. Upgrade to unlock deep insights, monthly growth trends, and detailed membership distribution."
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
            disabled={isExporting}
            variant="outline"
            className="rounded-xl border-primary/20 bg-white shadow-soft hover:bg-primary/5 text-primary font-bold transition-all"
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </>
            )}
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
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-lg font-bold text-slate-900">Revenue Growth</CardTitle>
              <Select
                value={String(selectedYear)}
                onValueChange={(value) => setSelectedYear(Number(value))}
              >
                <SelectTrigger className="h-9 w-28 rounded-xl border-slate-200 bg-white text-sm font-semibold">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    cursor={{ stroke: '#7B2CFF', strokeWidth: 1, strokeDasharray: '4 4' }}
                    content={({ active, label }) => {
                      if (!active || !label) return null;
                      const meta = revenueChartData.find((d) => d.month === label);
                      if (!meta) return null;
                      return (
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                          <p className="font-semibold text-slate-900">
                            {label} {selectedYear}
                          </p>
                          {meta.beforeRegistration ? (
                            <p className="mt-0.5 text-slate-500">
                              Gym registered since {meta.registeredLabel}
                            </p>
                          ) : (
                            <p className="mt-0.5 font-bold text-[#7B2CFF]">
                              ₹{Number(meta.revenue ?? 0).toLocaleString()}
                            </p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#7B2CFF"
                    strokeWidth={4}
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                    connectNulls={false}
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
              {planDistribution.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <Users className="h-8 w-8 text-slate-300" />
                  <p className="text-sm font-medium text-muted-foreground">No active members yet</p>
                  <p className="text-xs text-muted-foreground">
                    Plan distribution appears once members are active.
                  </p>
                </div>
              ) : (
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
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#7B2CFF05' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload as { name: string; count: number; percentage: number };
                        return (
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                            <p className="font-semibold text-slate-900">{d.name}</p>
                            <p className="mt-0.5 text-slate-600">
                              <span className="font-bold text-[#7B2CFF]">{d.count}</span>{' '}
                              {d.count === 1 ? 'member' : 'members'} · {d.percentage}%
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="count" radius={[10, 10, 0, 0]} barSize={40}>
                      {planDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Payment History — recent transactions ledger (all statuses) */}
        <Card className="border-border bg-white shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            {recentTransactions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <CreditCard className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-muted-foreground">No payments yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentTransactions.map((t) => {
                  const status = t.status.toLowerCase();
                  const badge =
                    status === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : status === "pending_verification"
                        ? "bg-amber-50 text-amber-700"
                        : status === "rejected"
                          ? "bg-red-50 text-red-600"
                          : "bg-slate-100 text-slate-600";
                  const label =
                    status === "success" ? "Paid"
                    : status === "pending_verification" ? "Pending"
                    : status === "rejected" ? "Rejected"
                    : t.status;
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{t.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t.plan} · {t.method}
                          {t.date && <> · {new Date(t.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-bold text-slate-900">₹{t.amount.toLocaleString("en-IN")}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badge}`}>{label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <PaymentLedger />
      </div>
    </ProtectedProRoute>
  );
}

