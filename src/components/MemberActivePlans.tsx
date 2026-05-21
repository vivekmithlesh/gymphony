import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { CalendarDays, Award, Clock, Loader2, Zap, CreditCard, CheckCircle2 } from "lucide-react";
import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { initiatePhonePePayment } from "@/lib/phonepe";

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
  subscription_end_date?: string;
  subscription_status?: string;
  gym_id?: string;
}

export function MemberActivePlans({ memberId }: MemberActivePlansProps) {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [gymPlans, setGymPlans] = useState<GymPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [showPlansModal, setShowPlansModal] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      // 1. Fetch from profiles (Primary)
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, membership_plan, joined_at, created_at, subscription_end_date, subscription_status, gym_id, status")
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
          full_name: profileData?.full_name || memberData?.full_name || "Member",
          gym_id: finalGymId,
          membership_plan: profileData?.membership_plan || memberData?.membership_plan || "",
          joined_at: profileData?.created_at || profileData?.joined_at || memberData?.joining_date,
          subscription_end_date: profileData?.subscription_end_date || memberData?.expiry_date,
          subscription_status: profileData?.subscription_status || profileData?.status || memberData?.status || "Inactive"
        };

        setProfile(mergedProfile);
        calculateDaysRemaining(mergedProfile.subscription_end_date);
        fetchGymPlans(finalGymId);
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
  }, [memberId]);

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
          const newProfile = payload.new as MemberProfile;
          setProfile(newProfile);
          calculateDaysRemaining(newProfile.subscription_end_date);
          if (newProfile.gym_id) fetchGymPlans(newProfile.gym_id);
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

  const handlePayFees = async (plan: GymPlan) => {
    if (!profile?.id || !profile?.gym_id) {
      toast.error("Profile or Gym information missing");
      return;
    }

    setIsProcessingPayment(true);
    try {
      await initiatePhonePePayment(
        plan.price,
        profile.id,
        async () => {
          // Success Callback
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + (Number(plan.duration_days) || 30));

          // 1. Update Profile
          const { error: profileError } = await supabase
            .from("profiles")
            .update({
              membership_plan: plan.plan_name,
              subscription_status: "Active",
              subscription_end_date: expiryDate.toISOString(),
              status: "Active"
            })
            .eq("id", profile.id);

          if (profileError) throw profileError;

          // 2. Update Members table for legacy support
          await supabase
            .from("members")
            .update({
              membership_plan: plan.plan_name,
              status: "Active",
              expiry_date: expiryDate.toISOString()
            })
            .eq("id", profile.id);

          // 3. Log Payment
          await supabase.from("payments").insert([{
            member_id: profile.id,
            gym_id: profile.gym_id,
            amount: plan.price,
            plan_name: plan.plan_name,
            status: "Success",
            payment_date: new Date().toISOString()
          }]);

          toast.success(`Plan ${plan.plan_name} activated!`);
          fetchProfile(); // Refresh data
        },
        setIsProcessingPayment
      );
    } catch (err: any) {
      console.error("Payment error:", err);
      toast.error("Payment failed. Please try again.");
    } finally {
      setIsProcessingPayment(false);
    }
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
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const isPlanActive = (daysRemaining !== null && daysRemaining > 0);

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
              <span className="text-[10px] font-black uppercase tracking-wider">Joined</span>
            </div>
            <p className="text-sm font-bold text-slate-900">{formatDate(profile?.joined_at)}</p>
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
        <div className={`p-4 rounded-2xl border flex items-center justify-between ${
          isPlanActive 
            ? "bg-emerald-50 border-emerald-100 text-emerald-700" 
            : "bg-amber-50 border-amber-100 text-amber-700"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
              isPlanActive ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
            }`}>
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70">
                {isPlanActive ? "Active for" : "Status"}
              </p>
              <p className="text-lg font-black tracking-tight">
                {isPlanActive ? `${daysRemaining} Days` : "Plan Expired"}
              </p>
            </div>
          </div>
          {isPlanActive ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          ) : (
            <Award className="h-6 w-6 text-amber-500" />
          )}
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
              gymPlans.map((plan) => {
                const isCurrentPlan = profile?.membership_plan === plan.plan_name && isPlanActive;
                return (
                  <div 
                    key={plan.id} 
                    className={`p-4 rounded-2xl border transition-all ${
                      isCurrentPlan 
                        ? "bg-primary/5 border-primary/20 ring-1 ring-primary/10" 
                        : "bg-white border-slate-100 hover:border-slate-200 shadow-sm"
                    }`}> 
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{plan.plan_name}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{plan.duration_days} Days</p>
                      </div>
                      <p className="text-lg font-black text-primary">₹{plan.price}</p>
                    </div>
                    
                    <Button
                      onClick={() => handlePayFees(plan)}
                      disabled={isProcessingPayment || isCurrentPlan}
                      className={`w-full h-11 rounded-xl font-bold transition-all ${
                        isCurrentPlan 
                          ? "bg-emerald-500 text-white cursor-default hover:bg-emerald-500" 
                          : "bg-slate-900 text-white hover:bg-slate-800"
                      }`}
                    >
                      {isProcessingPayment ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isCurrentPlan ? (
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Current Active Plan
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          {daysRemaining !== null && daysRemaining <= 0 ? "Renew Now" : "Upgrade / Pay Fees"}
                        </span>
                      )}
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                {isLoading ? (
                  <>
                    <p className="text-xs text-slate-400 font-bold">Checking for available plans...</p>
                    <Loader2 className="h-4 w-4 animate-spin mx-auto mt-2 text-primary/30" />
                  </>
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

    </Card>
  );
}


