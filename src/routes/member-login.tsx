import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, ArrowRight, Sparkles, LogIn, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { Navbar } from "@/components/Navbar";
import { memberSendOtp } from "@/server/api/auth/member-send-otp";
import { memberVerifyOtp } from "@/server/api/auth/member-verify-otp";
import { getRedirectForRole } from "@/lib/session-redirect";
import { currentSession } from "@/server/api/auth/current-session";

export const Route = createFileRoute("/member-login")({
  beforeLoad: async () => {
    const session = await currentSession();

    if (session) {
      throw redirect({ to: getRedirectForRole(session.role) });
    }
  },
  head: () => ({
    meta: [
      { title: "Member Login — Gymphony Portal" },
      {
        name: "description",
        content: "Access your personalized gym member portal to track progress and attendance.",
      },
    ],
  }),
  component: MemberLoginPage,
});

function MemberLoginPage() {
  const navigate = useNavigate();
  const [loginStep, setLoginStep] = useState<"phone" | "otp">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const normalizedPhone = phoneNumber.replace(/\D/g, "").slice(-10);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      const result = await memberSendOtp({
        data: {
          phone: normalizedPhone,
        },
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setLoginStep("otp");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send OTP");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      const result = await memberVerifyOtp({
        data: {
          phone: normalizedPhone,
          code: otpCode,
        },
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      navigate({ to: "/member-dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify OTP");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <Navbar />

      <main className="flex-grow relative flex items-center justify-center px-6 py-12">
        {/* Background Decorative Elements */}
        <div className="glow-orb top-0 right-0 h-96 w-96 bg-primary-glow opacity-20" />
        <div className="glow-orb bottom-0 left-0 h-80 w-80 bg-primary opacity-10" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative w-full max-w-md"
        >
          {/* Main Card with Glassmorphism */}
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/20 bg-white/40 p-8 md:p-12 shadow-elegant backdrop-blur-xl">
            {/* Soft internal glow */}
            <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />

            <div className="relative space-y-8">
              <div className="text-center space-y-3">
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary backdrop-blur"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Exclusive Member Access</span>
                </motion.div>
                <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl text-slate-900">
                  Member Portal <span className="text-gradient-brand">Login</span>
                </h1>
                <p className="text-sm text-muted-foreground">
                  Track your progress, view attendance, and manage your membership.
                </p>
              </div>

              <AnimatePresence mode="wait">
                {loginStep === "phone" ? (
                  <motion.form
                    key="phone-step"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                    onSubmit={handleSendOTP}
                  >
                    <div className="space-y-2 group">
                      <Label htmlFor="phone" className="text-sm font-bold text-slate-700 ml-1">
                        Registered Mobile Number
                      </Label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="+91 00000 00000"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="h-14 pl-12 bg-white/50 border-white/40 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-2xl text-lg font-medium text-slate-900 shadow-sm"
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-14 rounded-2xl bg-gradient-brand text-white font-bold text-lg shadow-glow hover:shadow-primary/40 transition-all group"
                    >
                      {isLoading ? (
                        <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          Send OTP
                          <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                        </>
                      )}
                    </Button>
                  </motion.form>
                ) : (
                  <motion.form
                    key="otp-step"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-8"
                    onSubmit={handleVerifyLogin}
                  >
                    <button
                      type="button"
                      onClick={() => setLoginStep("phone")}
                      className="flex items-center text-xs font-bold text-primary hover:underline mb-2"
                    >
                      <ChevronLeft className="h-3 w-3 mr-1" />
                      Change Number
                    </button>

                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="text-center space-y-1">
                        <p className="text-sm font-bold text-slate-700">Enter Verification Code</p>
                        <p className="text-xs text-muted-foreground">
                          Code sent to +91 {phoneNumber.slice(-5).padStart(phoneNumber.length, "*")}
                        </p>
                      </div>

                      <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                        <InputOTPGroup className="gap-4">
                          {[0, 1, 2, 3, 4, 5].map((index) => (
                            <InputOTPSlot
                              key={index}
                              index={index}
                              className="w-14 h-16 text-2xl font-bold rounded-2xl border-white/60 bg-white/50 text-slate-900 focus:ring-primary/20 focus:border-primary/50 transition-all shadow-sm"
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>

                    <div className="space-y-4">
                      <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full h-14 rounded-2xl bg-gradient-brand text-white font-bold text-lg shadow-glow hover:shadow-primary/40 transition-all"
                      >
                        {isLoading ? (
                          <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>
                            <LogIn className="mr-2 h-5 w-5" />
                            Verify & Login
                          </>
                        )}
                      </Button>

                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={handleSendOTP}
                        className="w-full text-xs font-bold text-muted-foreground hover:text-primary transition-colors text-center"
                      >
                        Didn't receive it? <span className="text-primary">Resend OTP</span>
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              <div className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">
                  By logging in, you agree to Gymphony's <br />
                  <a href="#" className="text-slate-900 hover:underline">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" className="text-slate-900 hover:underline">
                    Privacy Policy
                  </a>
                  .
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
