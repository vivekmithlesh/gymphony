import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export const Route = createFileRoute("/verify-otp")({
  head: () => ({
    meta: [
      { title: "Verify Your Account — Gymphony" },
      {
        name: "description",
        content: "Enter the verification code sent to your mobile number.",
      },
    ],
  }),
  component: VerifyOtpPage,
});

function VerifyOtpPage() {
  const navigate = useNavigate();

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, we'd verify the OTP here
    // For now, we'll just navigate to the dashboard
    navigate({ to: "/dashboard", search: { tab: undefined, section: undefined } });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      
      <main className="flex-grow relative flex items-center justify-center px-6 py-24 md:py-32 overflow-hidden">
        {/* Background orbs for glassmorphism effect */}
        <div className="glow-orb -top-20 right-1/4 h-72 w-72 bg-primary-glow opacity-30" />
        <div className="glow-orb bottom-20 left-1/4 h-96 w-96 bg-primary opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_color-mix(in_oklab,_var(--color-primary-glow)_10%,_transparent),_transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative w-full max-w-md"
        >
          {/* Form Container with Glassmorphism */}
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/5 p-8 md:p-12 shadow-2xl backdrop-blur-xl">
            {/* Inner glow effect */}
            <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
            
            <div className="relative space-y-8">
              <div className="text-center space-y-2">
                <motion.div 
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Secure Verification</span>
                </motion.div>
                <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                  Verify <span className="text-gradient-brand">Code</span>
                </h1>
                <p className="text-muted-foreground">
                  We've sent a 4-digit code to your mobile number.
                </p>
              </div>

              <form className="space-y-8" onSubmit={handleVerify}>
                <div className="flex flex-col items-center justify-center space-y-4">
                  <InputOTP maxLength={4}>
                    <InputOTPGroup className="gap-4">
                      <InputOTPSlot 
                        index={0}
                        className="w-14 h-16 text-2xl font-bold rounded-xl border-white/10 bg-white/5 focus:ring-primary/20 focus:border-primary/50 transition-all"
                      />
                      <InputOTPSlot 
                        index={1}
                        className="w-14 h-16 text-2xl font-bold rounded-xl border-white/10 bg-white/5 focus:ring-primary/20 focus:border-primary/50 transition-all"
                      />
                      <InputOTPSlot 
                        index={2}
                        className="w-14 h-16 text-2xl font-bold rounded-xl border-white/10 bg-white/5 focus:ring-primary/20 focus:border-primary/50 transition-all"
                      />
                      <InputOTPSlot 
                        index={3}
                        className="w-14 h-16 text-2xl font-bold rounded-xl border-white/10 bg-white/5 focus:ring-primary/20 focus:border-primary/50 transition-all"
                      />
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <div className="space-y-4">
                  <Button 
                    type="submit"
                    className="w-full h-14 rounded-xl bg-gradient-brand text-primary-foreground font-bold text-lg shadow-glow hover:shadow-primary/40 hover:-translate-y-0.5 transition-all group"
                  >
                    Verify Code
                    <CheckCircle2 className="ml-2 h-5 w-5 transition-transform group-hover:scale-110" />
                  </Button>

                  <div className="text-center">
                    <button 
                      type="button"
                      className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5"
                    >
                      Didn't receive it? <span className="font-semibold underline decoration-primary/30 underline-offset-4">Resend OTP</span>
                    </button>
                  </div>
                </div>

                <p className="text-center text-xs text-muted-foreground/60">
                  Step 2 of 2: Confirm your identity to get started.
                </p>
              </form>
            </div>
          </div>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
