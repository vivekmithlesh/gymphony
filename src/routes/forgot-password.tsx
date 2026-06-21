import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, KeyRound, Loader2, Mail, MailCheck, Sparkles } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/supabase";
import { toast } from "sonner";
import { isValidIndianMobile, looksLikeIndianMobile, toIndianLocal, toIndianE164 } from "@/lib/phone";

// Accept either an email OR a 10-digit Indian mobile — same identifier rule the
// owner login uses, so people reset with whatever they remember signing up with.
const forgotSchema = z.object({
  identifier: z
    .string()
    .min(1, "Email or mobile number is required")
    .refine(
      (v) => z.string().email().safeParse(v.trim()).success || isValidIndianMobile(v.trim()) || looksLikeIndianMobile(v),
      "Enter a valid email address or 10-digit mobile number",
    ),
});

type ForgotFormValues = z.infer<typeof forgotSchema>;

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — Gymphony" },
      {
        name: "description",
        content: "Forgot your password? Enter your email or mobile number and we'll send you a secure reset link.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { identifier: "" },
  });

  const onInvalid = () => {
    toast.error("Please enter a valid email or mobile number.");
  };

  const onSubmit = async (data: ForgotFormValues) => {
    setIsLoading(true);
    const raw = data.identifier.trim();
    try {
      let email = raw;

      // A mobile number isn't something Supabase can email — resolve it to the
      // account's email first (matches both the +91 E.164 and legacy bare-10-digit
      // rows, exactly like the login lookup).
      if (looksLikeIndianMobile(raw)) {
        const local = toIndianLocal(raw);
        const e164 = toIndianE164(raw);
        const { data: profile } = await supabase
          .from("gym_profiles")
          .select("email")
          .or(`mobile_number.eq.${e164},phone.eq.${e164},mobile_number.eq.${local},phone.eq.${local}`)
          .maybeSingle();

        // Anti-enumeration: if the number isn't on file we still show the same
        // success screen and simply don't send anything — never reveal whether an
        // account exists.
        if (!profile?.email) {
          setSentTo(raw);
          return;
        }
        email = profile.email;
      }

      // Supabase returns success even for unknown emails (anti-enumeration by
      // design), so we surface one generic confirmation regardless. The recovery
      // link lands on /reset-password, which finishes the password change.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // window.location.origin works in dev + prod; /reset-password must be in
        // Supabase Auth → URL Configuration → Redirect URLs.
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        // Rate limiting is the one error worth surfacing honestly.
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("rate") || msg.includes("too many")) {
          toast.error("Too many requests. Please wait a minute and try again.");
          return;
        }
        throw error;
      }

      setSentTo(email);
    } catch (err: any) {
      toast.error(err?.message || "Could not send the reset link. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <main className="grow relative flex items-center justify-center px-6 py-24 md:py-32 overflow-hidden">
        {/* Background orbs for glassmorphism effect */}
        <div className="glow-orb -top-20 left-1/4 h-72 w-72 bg-primary-glow opacity-30" />
        <div className="glow-orb bottom-20 right-1/4 h-96 w-96 bg-primary opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--color-primary-glow)_10%,transparent),transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative w-full max-w-lg"
        >
          {/* Form Container with Glassmorphism */}
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/5 p-8 md:p-12 shadow-2xl backdrop-blur-xl">
            {/* Inner glow effect */}
            <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />

            <div className="relative space-y-8">
              {sentTo ? (
                <div className="space-y-6 text-center">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"
                  >
                    <MailCheck className="h-8 w-8 text-primary" />
                  </motion.div>
                  <div className="space-y-2">
                    <h1 className="font-display text-3xl font-bold tracking-tight">Check your inbox</h1>
                    <p className="text-sm text-muted-foreground">
                      If an account exists for <span className="font-semibold text-foreground">{sentTo}</span>, we’ve sent a
                      password reset link. Open it to set a new password — it expires soon, so use it shortly.
                    </p>
                  </div>
                  <div className="space-y-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSentTo(null);
                        form.reset();
                      }}
                      className="w-full h-12 rounded-xl bg-white/5 border-white/10 text-white font-semibold hover:bg-white/10 transition-all"
                    >
                      Use a different email or number
                    </Button>
                    <Link
                      to="/login"
                      className="inline-flex w-full items-center justify-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors"
                    >
                      <ArrowLeft className="h-4 w-4" /> Back to login
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-center space-y-4">
                    <motion.div
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Account recovery</span>
                    </motion.div>

                    <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                      Forgot <span className="text-gradient-brand">Password?</span>
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      No worries. Enter the email or mobile number on your account and we’ll send you a secure link to reset
                      it.
                    </p>
                  </div>

                  <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
                    <div className="space-y-2 group">
                      <Label
                        htmlFor="identifier"
                        className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors"
                      >
                        Email or Mobile Number
                      </Label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="identifier"
                          autoFocus
                          {...form.register("identifier")}
                          placeholder="e.g. 9876543210 or you@gym.com"
                          className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${form.formState.errors.identifier ? "border-red-500" : ""}`}
                        />
                      </div>
                      {form.formState.errors.identifier && (
                        <p className="text-xs text-red-500">{form.formState.errors.identifier.message}</p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-14 rounded-xl bg-gradient-brand text-primary-foreground font-bold text-lg shadow-glow hover:shadow-primary/40 hover:-translate-y-0.5 transition-all group disabled:opacity-70"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="ml-2">Sending link...</span>
                        </>
                      ) : (
                        <>
                          <KeyRound className="mr-2 h-5 w-5" />
                          Send reset link
                          <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                        </>
                      )}
                    </Button>
                  </form>

                  <Link
                    to="/login"
                    className="inline-flex w-full items-center justify-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back to login
                  </Link>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
