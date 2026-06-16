export interface DashboardMetric {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down";
  isLive?: boolean;
}

export interface OverdueMember {
  name: string;
  plan: string;
  amount: string;
  days: number;
}

export interface NotificationItem {
  id: number;
  text: string;
  time: string;
  type: string;
  color: string;
}

export interface DashboardSummary {
  metrics: DashboardMetric[];
  overdueMembers: OverdueMember[];
  notifications: NotificationItem[];
}

export interface MemberRow {
  id: string;
  name: string;
  phone: string;
  plan: string;
  dueDate: string;
  status: "Active" | "Overdue";
}

export interface MemberListResponse {
  members: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateMemberInput {
  name: string;
  phone: string;
  planId: string;
  startDate: string;
}

export interface UpdateMemberInput {
  name?: string;
  phone?: string;
  planId?: string;
  status?: "ACTIVE" | "OVERDUE" | "EXPIRED";
}

export interface AttendanceMemberSummary {
  id: string;
  name: string;
  plan: string;
  avatar: string;
  dates: string[];
}

export interface AttendanceListResponse {
  members: AttendanceMemberSummary[];
  liveCount: number;
}

export interface RevenuePoint {
  month: string;
  amount: number;
}

export interface PlanDistribution {
  name: string;
  count: number;
  color: string;
}

export interface RevenueSummary {
  monthly: RevenuePoint[];
  planDistribution: PlanDistribution[];
  totalThisMonth: string;
  totalLastMonth: string;
}

export interface ProductRow {
  id: number;
  name: string;
  category: "Drink" | "Gear" | "PT";
  price: number;
  stock: number;
  status: "In Stock" | "Low Stock" | "Out of Stock";
  showInApp: boolean;
  icon: string;
}

export interface CreateProductInput {
  name: string;
  price: number;
  category: "Drink" | "Gear" | "PT";
  icon: string;
  stock: number;
}

export interface UpdateProductInput {
  name?: string;
  price?: number;
  category?: "Drink" | "Gear" | "PT";
  icon?: string;
  stock?: number;
  showInApp?: boolean;
}

export interface RazorpayOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface PaymentVerifyInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  membershipId: string;
}

export interface InsightTrendPoint {
  label: string;
  value: number;
}

export interface PeakHourPoint {
  label: string;
  value: number;
}

export interface ActiveMemberSummary {
  id: string;
  name: string;
  avatar: string;
  visits: number;
}

export interface AttendanceAnalytics {
  daily: {
    checkInsToday: number;
    uniqueMembersToday: number;
    lateToday: number;
    deltaVsYesterday: number;
  };
  monthly: {
    checkInsThisMonth: number;
    activeDays: number;
    avgPerActiveDay: number;
    lateThisMonth: number;
  };
  peakHours: PeakHourPoint[];
  mostActiveMembers: ActiveMemberSummary[];
  cooldownMinutes: number;
  lateCheckInHour: number;
}

export interface OwnerInsightCards {
  todayCheckIns: number;
  activeMembers: number;
  revenueThisMonth: string;
  newMembersThisMonth: number;
  renewalsDue: number;
  expiringMemberships: number;
  pendingPayments: number;
  memberGrowthPercent: string;
  memberGrowthTrend: "up" | "down";
}

export interface OwnerInsights {
  cards: OwnerInsightCards;
  attendanceTrend: InsightTrendPoint[];
  membershipGrowth: InsightTrendPoint[];
  revenueTrend: InsightTrendPoint[];
  planDistribution: PlanDistribution[];
}

export interface PublicPlan {
  id: string;
  name: string;
  displayPrice: string;
  pricePaise: number;
  billingPeriod: "TRIAL" | "MONTHLY" | "ANNUAL";
  isFree: boolean;
  benefits: string[];
}

export interface PublicGymInfo {
  id: string;
  name: string;
  city: string;
  location: string | null;
  logoUrl: string | null;
  isAcceptingMembers: boolean;
  plans: PublicPlan[];
}

export interface JoinInviteLink {
  gymId: string;
  gymName: string;
  joinPath: string;
}

export interface MemberPortalOverview {
  gymName: string;
  location: string;
  planName: string;
  expiryDate: string;
  status: string;
  totalMembers: number;
  memberRank: number;
  points: number;
}

export interface WorkoutHistoryItem {
  id: string;
  date: string;
  timeIn: string;
  timeOut: string;
  gymName: string;
  bonus?: string;
}

export interface LeaderboardMember {
  id: string;
  name: string;
  points: number;
  rank: number;
  isMe: boolean;
  avatar: string;
}

export interface StoreItem {
  id: number;
  name: string;
  price: string;
  category: string;
  icon: string;
}
