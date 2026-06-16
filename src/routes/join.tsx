import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  User,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { joinGymInfo } from "@/server/api/join/gym-info";
import { joinSession } from "@/server/api/join/session";
import { joinEnrollFree } from "@/server/api/join/enroll-free";
import { memberSignupStart } from "@/server/api/auth/member-signup-start";
import { memberSignupVerify } from "@/server/api/auth/member-signup-verify";
import { paymentCreateOrder } from "@/server/api/payments/create-order";
import { paymentVerify } from "@/server/api/payments/verify";
import type { PublicGymInfo, PublicPlan } from "@/types/gym.types";

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>): { gym?: string; plan?: string } => ({
    gym: typeof search.gym === "string" ? search.gym : undefined,
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Join Your Gym — Gymphony" },
      {
        name: "description",
        content: "Scan, sign up and activate your gym membership in seconds.",
      },
    ],
  }),
  component: JoinPage,
});

type Step = "signup" | "otp" | "enroll" | "success";

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function JoinPage() {
  const navigate = useNavigate();
  const { gym: gymId, plan: planParam } = Route.useSearch();

  const gymQuery = useQuery({
    queryKey: ["join-gym", gymId],
    queryFn: () => joinGymInfo({ data: { gymId: gymId as string } }),
    enabled: Boolean(gymId),
    retry: 1,
  });

  const sessionQuery = useQuery({
    queryKey: ["join-session"],
    queryFn: () => joinSession(),
  });

  const gym: PublicGymInfo | null = gymQuery.data?.success ? gymQuery.data.gym : null;

  const [step, setStep] = useState<Step>("signup");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string>(planParam ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activatedPlanName, setActivatedPlanName] = useState("");

  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);

  // When an authenticated member already belongs to *this* gym, skip signup
  // and let them straight into enrollment / upgrade.
  const isMemberOfThisGym =
    sessionQuery.data?.authenticated &&
    sessionQuery.data.role === "MEMBER" &&
    sessionQuery.data.gymId === gymId;

  useEffect(() => {
    if (isMemberOfThisGym && step === "signup") {
      setStep("enroll");
    }
  }, [isMemberOfThisGym, step]);

  const selectedPlan = useMemo<PublicPlan | undefined>(
    () => gym?.plans.find((plan) => plan.id === selectedPlanId),
    [gym, selectedPlanId],
  );

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gymId) return;

    try {
      setIsSubmitting(true);
      const result = await memberSignupStart({
        data: { fullName: fullName.trim(), phone: normalizedPhone, gymId },
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      setStep("otp");
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsSubmitting(true);
      const result = await memberSignupVerify({
        data: { phone: normalizedPhone, code: otpCode },
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      await sessionQuery.refetch();

      if (result.alreadyMember) {
        toast.success("Welcome back!");
        navigate({ to: "/member-dashboard" });
        return;
      }

      toast.success("Account created! Pick your plan.");
      setStep("enroll");
    } catch {
      toast.error("Network error while verifying. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnroll = async () => {
    if (!selectedPlan) {
      toast.error("Please select a plan to continue.");
      return;
    }

    if (selectedPlan.isFree) {
      try {
        setIsSubmitting(true);
        const result = await joinEnrollFree({ data: { planId: selectedPlan.id } });
        if (!result.success) {
          toast.error(result.message);
          return;
        }
        setActivatedPlanName(selectedPlan.name);
        setStep("success");
      } catch {
        toast.error("Could not activate membership. Please retry.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    await handlePaidEnroll(selectedPlan);
  };

  const handlePaidEnroll = async (plan: PublicPlan) => {
    setIsSubmitting(true);

    const scriptLoaded = await loadRazorpayScript();
    if (!scriptLoaded || !window.Razorpay) {
      setIsSubmitting(false);
      toast.error("Unable to load the payment gateway. Check your connection and retry.");
      return;
    }

    let order;
    try {
      order = await paymentCreateOrder({ data: { planId: plan.id } });
    } catch {
      setIsSubmitting(false);
      toast.error("Could not start checkout. Please retry.");
      return;
    }

    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: gym?.name ?? "Gymphony",
      description: `${plan.name} membership`,
      prefill: { name: fullName || undefined, contact: normalizedPhone || undefined },
      theme: { color: "#7b2cff" },
      handler: async (response: unknown) => {
        const r = response as {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        };
        try {
          const verify = await paymentVerify({
            data: {
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature,
              membershipId: "",
            },
          });
          if (verify.success) {
            setActivatedPlanName(plan.name);
            setStep("success");
          } else {
            toast.error(verify.message || "Payment could not be verified.");
          }
        } catch {
          toast.error("Payment verification failed. If charged, contact the gym.");
        } finally {
          setIsSubmitting(false);
        }
      },
    });

    rzp.on("payment.failed", () => {
      setIsSubmitting(false);
      toast.error("Payment failed. You can try again.");
    });

    // User closed the Razorpay modal without paying.
    rzp.on("modal.ondismiss", () => setIsSubmitting(false));

    rzp.open();
    // Safety net: if the modal is dismissed via the browser, re-enable actions.
    setTimeout(() => setIsSubmitting(false), 1500);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-4 py-10 relative overflow-hidden">
      <div className="glow-orb -top-20 left-1/4 h-72 w-72 bg-primary-glow opacity-25" />
      <div className="glow-orb bottom-10 right-1/4 h-96 w-96 bg-primary opacity-15" />

      <div className="relative w-full max-w-md space-y-6">
        {/* No gym id at all */}
        {!gymId ? (
          <ErrorCard
            title="Missing gym link"
            message="This page needs a gym QR or invite link. Ask your gym for theirs."
          />
        ) : gymQuery.isLoading || sessionQuery.isLoading ? (
          <GymHeaderSkeleton />
        ) : gymQuery.isError ? (
          <ErrorCard
            icon={<WifiOff className="h-7 w-7" />}
            title="Connection problem"
            message="We couldn't load this gym. Check your connection and try again."
            action={{ label: "Retry", onClick: () => gymQuery.refetch() }}
          />
        ) : !gym ? (
          <ErrorCard
            title="Gym not available"
            message={gymQuery.data?.message ?? "This gym link is invalid or has expired."}
          />
        ) : !gym.isAcceptingMembers ? (
          <ErrorCard
            title="Not accepting members"
            message={`${gym.name} isn't accepting new members right now. Please check back later.`}
          />
        ) : (
          <>
            <GymBranding gym={gym} />

            <AnimatePresence mode="wait">
              {step === "signup" && (
                <StepCard key="signup">
                  <form onSubmit={handleSendOtp} className="space-y-5">
                    <div className="space-y-1.5 text-center">
                      <h2 className="font-display text-2xl font-bold">Create your account</h2>
                      <p className="text-sm text-muted-foreground">
                        Join {gym.name} in under a minute.
                      </p>
                    </div>

                    <Field
                      id="fullName"
                      label="Full Name"
                      icon={<User className="h-4 w-4" />}
                      value={fullName}
                      onChange={setFullName}
                      placeholder="e.g. Priya Verma"
                    />
                    <Field
                      id="phone"
                      label="Mobile Number"
                      icon={<Phone className="h-4 w-4" />}
                      value={phone}
                      onChange={setPhone}
                      placeholder="+91 00000 00000"
                      type="tel"
                    />

                    <Button
                      type="submit"
                      disabled={
                        isSubmitting || fullName.trim().length < 2 || normalizedPhone.length !== 10
                      }
                      className="w-full h-13 py-3.5 rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow hover:-translate-y-0.5 transition-all"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          Send OTP <ArrowRight className="ml-2 h-5 w-5" />
                        </>
                      )}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      Already a member?{" "}
                      <Link
                        to="/member-login"
                        className="text-primary font-semibold hover:underline"
                      >
                        Log in
                      </Link>
                    </p>
                  </form>
                </StepCard>
              )}

              {step === "otp" && (
                <StepCard key="otp">
                  <form onSubmit={handleVerifyOtp} className="space-y-6">
                    <button
                      type="button"
                      onClick={() => setStep("signup")}
                      className="flex items-center text-xs font-bold text-primary hover:underline"
                    >
                      <ChevronLeft className="h-3 w-3 mr-1" /> Change details
                    </button>
                    <div className="space-y-1.5 text-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        <ShieldCheck className="h-3.5 w-3.5" /> Secure Verification
                      </div>
                      <h2 className="font-display text-2xl font-bold">Enter the code</h2>
                      <p className="text-sm text-muted-foreground">
                        Sent to +91 {normalizedPhone.replace(/(\d{5})(\d{5})/, "$1 $2")}
                      </p>
                    </div>

                    <div className="flex justify-center">
                      <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                        <InputOTPGroup className="gap-2">
                          {[0, 1, 2, 3, 4, 5].map((i) => (
                            <InputOTPSlot
                              key={i}
                              index={i}
                              className="w-11 h-14 text-xl font-bold rounded-xl border-white/10 bg-white/5"
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmitting || otpCode.length !== 6}
                      className="w-full py-3.5 rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow transition-all"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        "Verify & Continue"
                      )}
                    </Button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() =>
                        handleSendOtp(new Event("submit") as unknown as React.FormEvent)
                      }
                      className="w-full text-xs font-bold text-muted-foreground hover:text-primary"
                    >
                      Didn't get it? <span className="text-primary">Resend OTP</span>
                    </button>
                  </form>
                </StepCard>
              )}

              {step === "enroll" && (
                <StepCard key="enroll">
                  <div className="space-y-5">
                    <div className="space-y-1.5 text-center">
                      <h2 className="font-display text-2xl font-bold">Choose your plan</h2>
                      <p className="text-sm text-muted-foreground">
                        Pick a membership to activate instantly.
                      </p>
                    </div>

                    {gym.plans.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-6">
                        This gym hasn't published any plans yet. Please contact them directly.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {gym.plans.map((plan) => (
                          <PlanOption
                            key={plan.id}
                            plan={plan}
                            selected={selectedPlanId === plan.id}
                            onSelect={() => setSelectedPlanId(plan.id)}
                          />
                        ))}
                      </div>
                    )}

                    <Button
                      onClick={handleEnroll}
                      disabled={isSubmitting || !selectedPlan}
                      className="w-full py-3.5 rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow transition-all"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : selectedPlan?.isFree ? (
                        "Activate Membership"
                      ) : selectedPlan ? (
                        `Pay ${selectedPlan.displayPrice} & Join`
                      ) : (
                        "Select a plan"
                      )}
                    </Button>
                  </div>
                </StepCard>
              )}

              {step === "success" && (
                <StepCard key="success">
                  <div className="text-center space-y-5 py-4">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 15 }}
                      className="mx-auto h-20 w-20 rounded-full bg-emerald-500/15 flex items-center justify-center"
                    >
                      <CheckCircle2 className="h-11 w-11 text-emerald-500" />
                    </motion.div>
                    <div className="space-y-1.5">
                      <h2 className="font-display text-2xl font-bold">You're all set! 🎉</h2>
                      <p className="text-sm text-muted-foreground">
                        Your {activatedPlanName} membership at {gym.name} is now active.
                      </p>
                    </div>
                    <Button
                      onClick={() => navigate({ to: "/member-dashboard" })}
                      className="w-full py-3.5 rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow transition-all"
                    >
                      Go to My Pass <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </div>
                </StepCard>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}

function GymBranding({ gym }: { gym: PublicGymInfo }) {
  return (
    <div className="flex flex-col items-center text-center gap-3">
      <div className="h-16 w-16 rounded-2xl bg-gradient-brand flex items-center justify-center shadow-glow overflow-hidden">
        {gym.logoUrl ? (
          <img src={gym.logoUrl} alt={gym.name} className="h-full w-full object-cover" />
        ) : (
          <Building2 className="h-8 w-8 text-white" />
        )}
      </div>
      <div>
        <h1 className="font-display text-xl font-bold">{gym.name}</h1>
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
          <MapPin className="h-3 w-3" />
          {gym.location || gym.city}
        </p>
      </div>
    </div>
  );
}

function PlanOption({
  plan,
  selected,
  onSelect,
}: {
  plan: PublicPlan;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border p-4 transition-all ${
        selected
          ? "border-primary bg-primary/10 shadow-glow"
          : "border-white/10 bg-white/5 hover:border-primary/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold">{plan.name}</span>
            {plan.isFree && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                Free
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground capitalize">
            {plan.billingPeriod.toLowerCase()} billing
          </span>
        </div>
        <div className="text-right">
          <div className="text-lg font-black text-primary">{plan.displayPrice}</div>
        </div>
      </div>
      <ul className="mt-3 grid gap-1.5">
        {plan.benefits.map((benefit) => (
          <li key={benefit} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
            {benefit}
          </li>
        ))}
      </ul>
    </button>
  );
}

function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.25 }}
      className="rounded-[2rem] border border-white/10 bg-white/5 backdrop-blur-xl p-6 md:p-8 shadow-2xl"
    >
      {children}
    </motion.div>
  );
}

function Field({
  id,
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div className="space-y-2 group">
      <Label htmlFor={id} className="text-sm font-medium text-foreground/80">
        {label}
      </Label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
          {icon}
        </span>
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 rounded-xl"
        />
      </div>
    </div>
  );
}

function GymHeaderSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex flex-col items-center gap-3">
        <div className="h-16 w-16 rounded-2xl bg-white/10" />
        <div className="h-5 w-32 rounded bg-white/10" />
        <div className="h-3 w-20 rounded bg-white/10" />
      </div>
      <div className="h-72 rounded-[2rem] bg-white/5 border border-white/10" />
    </div>
  );
}

function ErrorCard({
  title,
  message,
  icon,
  action,
}: {
  title: string;
  message: string;
  icon?: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/5 backdrop-blur-xl p-8 text-center space-y-4 shadow-2xl">
      <div className="mx-auto h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center text-red-400">
        {icon ?? <Building2 className="h-7 w-7" />}
      </div>
      <div className="space-y-1.5">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <div className="flex flex-col gap-2">
        {action && (
          <Button
            onClick={action.onClick}
            className="w-full py-3 rounded-xl bg-gradient-brand font-bold"
          >
            {action.label}
          </Button>
        )}
        <Link
          to="/"
          className="text-xs font-semibold text-muted-foreground hover:text-primary transition-colors"
        >
          Back to Gymphony
        </Link>
      </div>
    </div>
  );
}
