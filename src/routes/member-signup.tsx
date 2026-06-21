import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Lock, User as UserIcon, ArrowRight, Sparkles, Loader2, Lock as LockIcon } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { registerMember, ensureMemberProfile, claimInvite } from "@/lib/member-signup";
import { IndianMobileInput } from "@/components/IndianMobileInput";
import { toIndianLocal, toIndianE164 } from "@/lib/phone";
import { postAuthDestination } from "@/lib/auth-redirect";

const memberSignupSchema = z.object({
  fullName: z.string().min(2, "Please enter your name"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type MemberSignupFormValues = z.infer<typeof memberSignupSchema>;

export const Route = createFileRoute("/member-signup")({
  head: () => ({
    meta: [
      { title: "Create Member Account — Gymphony" },
      {
        name: "description",
        content: "Sign up as a gym member to track attendance, plans, and progress.",
      },
    ],
  }),
  component: MemberSignupPage,
});

function MemberSignupPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  // BulkOnboard invite params (owner-generated): when present this is an
  // "activate my membership" flow with a phone locked to the invite.
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const inviteToken = urlParams.get("token") || urlParams.get("member_slot");
  const inviteGymId = urlParams.get("gym_id");
  const invitePhoneParam = urlParams.get("phone");
  const isInvite = Boolean(invitePhoneParam && (inviteToken || inviteGymId));
  const lockedPhoneLocal = toIndianLocal(invitePhoneParam || "");

  const form = useForm<MemberSignupFormValues>({
    resolver: zodResolver(memberSignupSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  const onSubmit = async (data: MemberSignupFormValues) => {
    setIsLoading(true);
    try {
      const outcome = await registerMember({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
      });

      if (outcome.status === "exists") {
        toast.error("You're already registered. Please log in instead.");
        navigate({ to: "/member-login" });
        return;
      }

      if (isInvite) {
        // Bind to the owner-created slot. Phone is locked to the invite.
        const phoneE164 = toIndianE164(invitePhoneParam || "");
        const { duplicate } = await claimInvite({
          userId: outcome.user.id,
          inviteToken,
          inviteGymId,
          fullName: data.fullName,
          phoneE164,
        });
        if (duplicate) {
          toast.error("This account already exists. Please log in instead.");
          navigate({ to: "/member-login" });
          return;
        }
        form.reset();
        if (outcome.hasSession) {
          toast.success("✅ Account created. Your membership is now active.");
          navigate({ to: "/member-dashboard", replace: true });
        } else {
          toast.success("✅ Account created. Please confirm your email, then log in.");
          navigate({ to: "/member-login", replace: true });
        }
        return;
      }

      // Self-serve: ensure base rows, then send to the saved gym destination
      // (e.g. a /join/:gymId invite they came from) or the Join Gym screen.
      await ensureMemberProfile(outcome.user);
      form.reset();
      if (outcome.hasSession) {
        toast.success("✅ Account created! Let's find your gym.");
        const dest = postAuthDestination() || "/member-join";
        // Hard navigation so the destination mounts cleanly past the auth redirects.
        if (typeof window !== "undefined") window.location.assign(dest);
      } else {
        toast.success("✅ Account created. Please confirm your email, then log in.");
        navigate({ to: "/member-login", replace: true });
      }
    } catch (err: any) {
      console.error("Member signup error:", err);
      toast.error(err?.message || "Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <main className="grow relative flex items-center justify-center px-6 py-24 md:py-32 overflow-hidden">
        <div className="glow-orb -top-20 left-1/4 h-72 w-72 bg-primary-glow opacity-30" />
        <div className="glow-orb bottom-20 right-1/4 h-96 w-96 bg-primary opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--color-primary-glow)_10%,transparent),transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative w-full max-w-lg"
        >
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/5 p-8 md:p-12 shadow-2xl backdrop-blur-xl">
            <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />

            <div className="relative space-y-8">
              <div className="text-center space-y-4">
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{isInvite ? "Activate Membership" : "Join as a Member"}</span>
                </motion.div>

                <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                  {isInvite ? (
                    <>Activate <span className="text-gradient-brand">Membership</span></>
                  ) : (
                    <>Create <span className="text-gradient-brand">Member Account</span></>
                  )}
                </h1>
              </div>

              <div className="space-y-6">
                <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
                  <div className="space-y-4">
                    <div className="space-y-2 group">
                      <Label htmlFor="fullName" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Full Name</Label>
                      <div className="relative">
                        <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="fullName"
                          {...form.register("fullName")}
                          placeholder="e.g. Rohit Sharma"
                          className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${form.formState.errors.fullName ? "border-red-500" : ""}`}
                        />
                      </div>
                      {form.formState.errors.fullName && <p className="text-xs text-red-500">{form.formState.errors.fullName.message}</p>}
                    </div>

                    {isInvite && (
                      <div className="space-y-2">
                        <IndianMobileInput
                          id="invite-phone"
                          label="Mobile Number"
                          value={lockedPhoneLocal}
                          onChange={() => {}}
                          disabled
                          inputClassName="bg-white/5 border-white/10"
                        />
                        <p className="flex items-center gap-1.5 text-xs text-primary/80">
                          <LockIcon className="h-3 w-3" />
                          Your number is set by your gym and can’t be changed — it secures your membership identity.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2 group">
                      <Label htmlFor="email" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="email"
                          type="email"
                          {...form.register("email")}
                          placeholder="you@example.com"
                          className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${form.formState.errors.email ? "border-red-500" : ""}`}
                        />
                      </div>
                      {form.formState.errors.email && <p className="text-xs text-red-500">{form.formState.errors.email.message}</p>}
                    </div>

                    <div className="space-y-2 group">
                      <Label htmlFor="password" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="password"
                          type="password"
                          {...form.register("password")}
                          placeholder="••••••••"
                          className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${form.formState.errors.password ? "border-red-500" : ""}`}
                        />
                      </div>
                      {form.formState.errors.password && <p className="text-xs text-red-500">{form.formState.errors.password.message}</p>}
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-14 rounded-xl bg-gradient-brand text-primary-foreground font-bold text-lg shadow-glow hover:shadow-primary/40 hover:-translate-y-0.5 transition-all group disabled:opacity-70"
                  >
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                      <>{isInvite ? "Activate Membership" : "Create Account"} <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" /></>
                    )}
                  </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/member-login" })}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Log in
                  </button>
                </p>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                By continuing, you agree to our{" "}
                <a href="#" className="underline hover:text-primary">Terms of Service</a>
                {" "}and{" "}
                <a href="#" className="underline hover:text-primary">Privacy Policy</a>.
              </p>
            </div>
          </div>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
