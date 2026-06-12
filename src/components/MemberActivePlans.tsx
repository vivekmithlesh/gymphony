import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { CalendarDays, Award, Clock, Loader2, Zap, CreditCard, CheckCircle2 } from "lucide-react";
import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MemberUpiCheckout } from "@/components/MemberUpiCheckout";
import { PremiumSyncing } from "@/components/PremiumLoader";

interface MemberActivePlansProps {
  memberId: string;
}

interface GymPlan {
  id: string;
  plan_name: string;
  price: number;
  duration_days: number;
  features?: string[];
  gym_owner_id?: string | null;
}

interface MemberProfile {
  id: string;
  full_name?: string;
  membership_plan?: string;
  joined_at?: string;
  subscription_start?: string;
  subscription_end_date?: string;
  subscription_status?: string;
  gym_id?: string;
}

// The gym's payment + legal details, read from gym_settings, needed to render
// the zero-fee UPI checkout (owner's UPI handle + compliance links).
interface GymInfo {
  gym_name?: string | null;
  gym_owner_id?: string | null;
  upi_id?: string | null;
  terms_url?: string | null;
  privacy_url?: string | null;
  refund_url?: string | null;
}

export function MemberActivePlans({ memberId }: MemberActivePlansProps) {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [gymPlans, setGymPlans] = useState<GymPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  // The date the *current subscription* began — i.e. the latest approved
  // (Success) payment. This is distinct from the gym-join date (created_at),
  // which now lives on the Virtual ID Card. Null until a plan is purchased.
  const [subscriptionStart, setSubscriptionStart] = useState<string | null>(null);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [gymInfo, setGymInfo] = useState<GymInfo | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<GymPlan | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  // Subscription start = the latest Success payment. Members can read their own
  // payments (RLS: payments_member_select), so this is a direct lookup. Returns
  // null for owner-activated members who have no payment row — the render then
  // derives a start from expiry minus the plan duration.
  const fetchSubscriptionStart = useCallback(async () => {
    const { data } = await supabase
      .from("payments")
      .select("payment_date, created_at")
      .eq("member_id", memberId)
      .eq("status", "Success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSubscriptionStart(data?.payment_date || data?.created_at || null);
  }, [memberId]);

  const fetchProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      // 1. Fetch from profiles (Primary)
      // NOTE: this DB's `profiles` has no subscription_end_date/subscription_status
      // columns — the membership period lives in `expiry_date` + `status` (what
      // approve_payment writes). Selecting nonexistent columns errors the whole
      // query, so we read the real ones.
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, membership_plan, created_at, subscription_start, expiry_date, gym_id, status")
        .eq("id", memberId)
        .maybeSingle();

      if (profileError) console.error("ActivePlans: Profile fetch error:", profileError);

      // 2. Fetch from members (Fallback/Legacy)
      const { data: memberData } = await supabase
        .from("members")
        .select("gym_id, membership_plan, joining_date, expiry_date, status")
        .eq("id", memberId)
        .maybeSingle();

      const finalGymId = profileData?.gym_id || memberData?.gym_id;
      
      if (finalGymId) {
        // Core Logic: Prioritize real data, use fallbacks only if primary is null
        const mergedProfile: MemberProfile = {
          id: memberId,
          full_name: profileData?.full_name || "Member",
          gym_id: finalGymId,
          membership_plan: profileData?.membership_plan || memberData?.membership_plan || "",
          joined_at: profileData?.created_at || memberData?.joining_date,
          subscription_start: profileData?.subscription_start,
          subscription_end_date: profileData?.expiry_date || memberData?.expiry_date,
          subscription_status: profileData?.status || memberData?.status || "Inactive"
        };

        setProfile(mergedProfile);
        calculateDaysRemaining(mergedProfile.subscription_end_date);
        fetchSubscriptionStart();
        fetchGymPlans(finalGymId);
        fetchGymInfo(finalGymId);
      } else {
        console.warn("ActivePlans: No gym_id found for member", memberId);
        setProfile(null);
        setGymPlans([]);
      }
    } catch (error: any) {
      console.error("ActivePlans: Unexpected error:", error.message);
    } finally {
      setIsLoading(false);
    }
  }, [memberId, fetchSubscriptionStart]);

  const fetchGymPlans = async (gymId: string) => {
    try {
      console.log("ActivePlans: Fetching plans for gym", gymId);
      // 1. Prefer membership_plans (new canonical table)
      const { data: membershipPlans, error: membershipError } = await supabase
        .from("membership_plans")
        .select("*")
        .eq("gym_id", gymId)
        .order("created_at", { ascending: true });

      if (!membershipError && membershipPlans && membershipPlans.length > 0) {
        const normalizedPlans = membershipPlans.map((p: any) => ({
          id: p.id,
          plan_name: p.plan_name || p.name,
          price: p.price,
          duration_days: (p.duration * 30) || p.duration_days || 30,
          features: p.features || ["Full Gym Access", "Expert Guidance", "Free WiFi"]
        }));
        setGymPlans(normalizedPlans);
        return;
      }

      // 2. Fallback: gym_plans table (legacy)
      const { data: tablePlans, error: tableError } = await supabase
        .from("gym_plans")
        .select("*")
        .eq("gym_id", gymId);

      if (!tableError && tablePlans && tablePlans.length > 0) {
        console.log("ActivePlans: Found plans in gym_plans table", tablePlans.length);
        const normalizedPlans = tablePlans.map(p => ({
          id: p.id,
          plan_name: p.name || p.plan_name,
          price: p.price,
          duration_days: (p.duration * 30) || p.duration_days || 30,
          features: p.features || ["Full Gym Access", "Expert Guidance", "Free WiFi"]
        }));
        setGymPlans(normalizedPlans);
        return;
      }

      // 3. Fallback: Check if plans are linked by gym_owner_id (for legacy/owner-linked plans)
      const { data: gymData } = await supabase
        .from("gym_settings")
        .select("gym_owner_id, plans")
        .eq("id", gymId)
        .maybeSingle();

      if (gymData?.gym_owner_id) {
        const { data: ownerPlans } = await supabase
          .from("gym_plans")
          .select("*")
          .eq("gym_owner_id", gymData.gym_owner_id);

        if (ownerPlans && ownerPlans.length > 0) {
          console.log("ActivePlans: Found plans linked by owner ID", ownerPlans.length);
          const normalizedPlans = ownerPlans.map(p => ({
            id: p.id,
            plan_name: p.name || p.plan_name,
            price: p.price,
            duration_days: (p.duration * 30) || p.duration_days || 30,
            features: p.features || ["Full Gym Access", "Expert Guidance", "Free WiFi"]
          }));
          setGymPlans(normalizedPlans);
          return;
        }
      }

      // 3. Last fallback: JSONB plans in gym_settings
      if (gymData?.plans && Array.isArray(gymData.plans) && gymData.plans.length > 0) {
        console.log("ActivePlans: Falling back to JSONB plans");
        setGymPlans(gymData.plans);
        return;
      }

      console.warn("ActivePlans: No plans found for gym", gymId);
      setGymPlans([]);
    } catch (error: any) {
      console.error("ActivePlans: Plans fetch error:", error.message);
      setGymPlans([]);
    }
  };

  // Owner's UPI handle + compliance links for the checkout dialog.
  const fetchGymInfo = async (gymId: string) => {
    const { data } = await supabase
      .from("gym_settings")
      .select("gym_name, gym_owner_id, upi_id, terms_url, privacy_url, refund_url")
      .eq("id", gymId)
      .maybeSingle();
    if (data) setGymInfo(data as GymInfo);
  };

  const calculateDaysRemaining = (expiryDateStr?: string) => {
    if (!expiryDateStr) {
      setDaysRemaining(null);
      return;
    }
    const expiryDate = new Date(expiryDateStr);
    if (isNaN(expiryDate.getTime())) {
      setDaysRemaining(null);
      return;
    }
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setDaysRemaining(diffDays);
  };

  useEffect(() => {
    fetchProfile();

    // 1. Real-time Sync for Profile
    const profileChannel = supabase
      .channel(`profile-updates-${memberId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${memberId}` },
        (payload) => {
          console.log("Profile updated real-time:", payload.new);
          // payload.new is the raw profiles row (expiry_date/status), so map it
          // onto the card's shape — otherwise approval would blank the card.
          const row = payload.new as any;
          const mapped: MemberProfile = {
            id: row.id,
            full_name: row.full_name,
            gym_id: row.gym_id,
            membership_plan: row.membership_plan,
            joined_at: row.created_at,
            subscription_start: row.subscription_start,
            subscription_end_date: row.expiry_date,
            subscription_status: row.status,
          };
          setProfile(mapped);
          calculateDaysRemaining(mapped.subscription_end_date);
          fetchSubscriptionStart(); // approval may have added a Success payment
          if (mapped.gym_id) fetchGymPlans(mapped.gym_id);
        }
      )
      .subscribe();

    // 2. Real-time Sync for Payments (Triggers profile refresh on successful payment)
    const paymentChannel = supabase
      .channel(`payment-updates-${memberId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payments", filter: `member_id=eq.${memberId}` },
        (payload) => {
          console.log("New payment detected real-time:", payload.new);
          if (payload.new.status === "Success") {
            fetchProfile(); // Re-fetch profile to get updated subscription dates
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
      supabase.removeChannel(paymentChannel);
    };
  }, [memberId, fetchProfile]);

  useEffect(() => {
    // 2. Real-time Sync for Gym Plans & Settings (Dependent on profile.gym_id)
    if (!profile?.gym_id) return;
    
    const gymId = profile.gym_id;
    const channelId = Math.random().toString(36).substring(7);
    const gymChannel = supabase
      .channel(`gym-updates-${gymId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gym_plans", filter: `gym_owner_id=eq.${gymId}` },
        () => fetchGymPlans(gymId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gym_plans", filter: `gym_id=eq.${gymId}` },
        () => fetchGymPlans(gymId)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "gym_settings", filter: `gym_owner_id=eq.${gymId}` },
        () => fetchGymPlans(gymId)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "gym_settings", filter: `id=eq.${gymId}` },
        () => fetchGymPlans(gymId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(gymChannel);
    };
  }, [profile?.gym_id]);

  // Members can no longer self-activate. Tapping "Pay Fees" opens the zero-fee
  // UPI checkout, which records a 'pending_verification' payment; the gym owner
  // approves it from their dashboard and the approve_payment RPC activates the
  // plan server-side. (Direct profiles/members/payments writes are now blocked
  // by RLS + the membership-column trigger.)
  const handlePayFees = (plan: GymPlan) => {
    if (!profile?.id || !profile?.gym_id) {
      toast.error("Profile or Gym information missing");
      return;
    }
    setCheckoutPlan(plan);
    setShowCheckout(true);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <Card className="bg-white rounded-3xl border border-slate-200 shadow-sm">
        <CardContent className="p-8">
          <PremiumSyncing label="Loading subscription…" />
        </CardContent>
      </Card>
    );
  }

  // Three distinct states — crucially, a null expiry means "no plan on record",
  // NOT "expired". Treating those the same showed freshly-joined members a scary
  // "Plan Expired" banner. (Expiry is only written by approve_payment / bulk
  // onboard, so owner-activated members legitimately have no date yet.)
  const planState: "active" | "expired" | "none" =
    daysRemaining === null ? "none" : daysRemaining > 0 ? "active" : "expired";
  const isPlanActive = planState === "active";

  const statusStyle = {
    active: {
      wrap: "bg-emerald-50 border-emerald-100 text-emerald-700",
      badge: "bg-emerald-500 text-white",
      label: "Active for",
      value: `${daysRemaining} Days`,
      icon: <CheckCircle2 className="h-6 w-6 text-emerald-500" />,
    },
    expired: {
      wrap: "bg-amber-50 border-amber-100 text-amber-700",
      badge: "bg-amber-500 text-white",
      label: "Status",
      value: "Plan Expired",
      icon: <Award className="h-6 w-6 text-amber-500" />,
    },
    none: {
      wrap: "bg-slate-50 border-slate-200 text-slate-600",
      badge: "bg-slate-400 text-white",
      label: "Status",
      value: "No Active Plan",
      icon: <Award className="h-6 w-6 text-slate-400" />,
    },
  }[planState];

  // When the subscription started. Prefer the recorded subscription_start
  // (written by approve_payment), then the latest Success payment; finally, for
  // legacy/owner-activated members with neither, derive it from expiry minus the
  // matched plan's duration so the card still shows an honest window.
  const matchedPlan = gymPlans.find((p) => p.plan_name === profile?.membership_plan);
  const startDate: string | null =
    profile?.subscription_start ||
    subscriptionStart ||
    (profile?.subscription_end_date && matchedPlan
      ? new Date(
          new Date(profile.subscription_end_date).getTime() - matchedPlan.duration_days * 86400000,
        ).toISOString()
      : null);

  return (
    <Card className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="p-6 pb-2">
        <CardTitle className="text-lg font-bold text-slate-900">Subscription Status</CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-2 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-1">
            <div className="flex items-center gap-2 text-slate-500">
              <CalendarDays className="h-4 w-4" />
              <span className="text-[10px] font-black uppercase tracking-wider">Started</span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {planState === "none" ? "—" : formatDate(startDate ?? undefined)}
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-1">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock className="h-4 w-4" />
              <span className="text-[10px] font-black uppercase tracking-wider">Expires</span>
            </div>
            <p className="text-sm font-bold text-slate-900">{formatDate(profile?.subscription_end_date)}</p>
          </div>
        </div>

        {/* Status Banner */}
        <div className={`p-4 rounded-2xl border flex items-center justify-between ${statusStyle.wrap}`}>
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${statusStyle.badge}`}>
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70">
                {statusStyle.label}
              </p>
              <p className="text-lg font-black tracking-tight">
                {statusStyle.value}
              </p>
            </div>
          </div>
          {statusStyle.icon}
        </div>

        {/* Available Plans */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900">Available Plans</h4>
            <Button variant="outline" className="text-[10px] uppercase tracking-widest font-black rounded-xl" onClick={() => setShowPlansModal(true)}>Gym Rates</Button>
          </div>

          <div className="space-y-3">
            {(!profile?.membership_plan) && (
              <div className="p-4 rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                <p className="text-sm text-slate-600">Contact Admin to Link Plan</p>
                <Button size="sm" className="mt-3" onClick={() => setShowPlansModal(true)}>View Gym Rates</Button>
              </div>
            )}

            {gymPlans.length > 0 ? (
              // Vertical scrollable list — every plan visible, no carousel.
              <div className="max-h-[300px] space-y-3 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar">
                {gymPlans.map((plan) => {
                  const isCurrentPlan = profile?.membership_plan === plan.plan_name && isPlanActive;
                  return (
                    <div
                      key={plan.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-4 transition-all ${
                        isCurrentPlan
                          ? "bg-primary/5 border-primary/30 ring-1 ring-primary/10"
                          : "bg-white border-slate-100 shadow-sm"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{plan.plan_name}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {plan.duration_days} Days · <span className="text-primary">₹{plan.price}</span>
                        </p>
                      </div>

                      {isCurrentPlan ? (
                        <Badge className="shrink-0 gap-1 rounded-xl border-none bg-emerald-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-500">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Current Plan
                        </Badge>
                      ) : (
                        <Button
                          onClick={() => handlePayFees(plan)}
                          disabled={isProcessingPayment}
                          className="h-10 shrink-0 rounded-xl bg-slate-900 px-4 font-bold text-white hover:bg-slate-800"
                        >
                          {isProcessingPayment ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <CreditCard className="h-4 w-4" />
                              {planState === "expired" ? "Renew" : "Buy Now"}
                            </span>
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                {isLoading ? (
                  <PremiumSyncing label="Checking for available plans…" />
                ) : (
                  <p className="text-xs text-slate-400 font-bold">No plans configured for this gym.</p>
                )}
              </div>
            )}
          </div>
        </div>
          </CardContent>

      {/* Plans Modal for viewing gym rates */}
      <Dialog open={showPlansModal} onOpenChange={setShowPlansModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gym Plans & Pricing</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <div className="p-6">
            {gymPlans.length === 0 ? (
              <p className="text-sm text-slate-600">No plans configured for this gym.</p>
            ) : (
              <div className="space-y-3">
                {gymPlans.map((plan) => (
                  <div key={plan.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100">
                    <div>
                      <p className="font-semibold">{plan.plan_name}</p>
                      <p className="text-xs text-slate-500">{plan.duration_days} days</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black">₹{plan.price}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Zero-fee UPI checkout — records a pending payment for owner approval. */}
      <MemberUpiCheckout
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        plan={checkoutPlan ? { plan_name: checkoutPlan.plan_name, price: checkoutPlan.price } : null}
        upiId={gymInfo?.upi_id}
        gymName={gymInfo?.gym_name || "your gym"}
        memberId={profile?.id || memberId}
        gymId={profile?.gym_id || ""}
        gymOwnerId={gymInfo?.gym_owner_id || ""}
        termsUrl={gymInfo?.terms_url}
        privacyUrl={gymInfo?.privacy_url}
        refundUrl={gymInfo?.refund_url}
        onSubmitted={() => setShowCheckout(false)}
      />

    </Card>
  );
}


