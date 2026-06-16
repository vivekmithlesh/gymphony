import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Mail, Lock, ArrowRight, Sparkles, LogIn, Chrome, Loader2 } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { postAuthDestination, readRedirectParam, isSafeRedirectPath } from "@/lib/auth-redirect";
import { logEvent } from "@/lib/logger";
// Member-login enforces member-only flow; avoid role fallback logic.

const memberLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type MemberLoginFormValues = z.infer<typeof memberLoginSchema>;

export const Route = createFileRoute("/member-login")({
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
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const { session } = useAuth();

  // Single navigation authority: once a session exists (fresh login OR arriving
  // already signed in), honour a saved QR destination (e.g. /checkin/:id) first,
  // otherwise land on the member dashboard. A real navigation is used for the
  // redirect so it can't race with the global <AuthRedirects/>.
  useEffect(() => {
    if (!session) return;
    const target = postAuthDestination();
    logEvent("auth", "post-login-redirect", { target: target ?? "/member-dashboard" });
    if (target) {
      window.location.assign(target);
      return;
    }
    navigate({ to: "/member-dashboard", replace: true });
  }, [session, navigate]);

  const loginForm = useForm<MemberLoginFormValues>({
    resolver: zodResolver(memberLoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onLoginInvalid = () => {
    toast.error("Please enter both email and password.");
  };

  const ensureMemberProfile = async (user: any) => {
    try {
      const { data: profileRow, error: profileFetchError } = await supabase
        .from("profiles")
        .select("id, gym_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileFetchError) {
        console.error("Error checking profile:", profileFetchError);
      }

      // 1. Create the profile row if missing.
      if (!profileRow) {
        const { error: profileInsertError } = await supabase
          .from("profiles")
          .insert([{
            id: user.id,
            full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Member",
            email: user.email,
            status: "Active",
            role: "member",
          }]);

        if (profileInsertError) {
          console.error("Profile insert failed:", profileInsertError);
        }
      }

      // 2. Sync with the members table (for owner visibility).
      const { data: existingMember, error: memberFetchError } = await supabase
        .from("members")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (memberFetchError) {
        console.error("Error checking member table:", memberFetchError);
      }

      if (!existingMember) {
        const { error: memberInsertError } = await supabase
          .from("members")
          .insert([
            {
              id: user.id,
              full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "New Member",
              email: user.email,
              status: "Active",
              joining_date: new Date().toISOString().split("T")[0],
              role: "member",
            },
          ]);

        if (memberInsertError) {
          console.error("Member insert failed:", memberInsertError);
        }
      }
    } catch (err) {
      console.error("Unexpected error in ensureMemberProfile:", err);
    }
  };

  const onLoginSubmit = async (data: MemberLoginFormValues) => {
    setIsLoading(true);
    try {
      const { data: loginData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();

        // Combined "Login / Sign Up": if the account doesn't exist yet, create it.
        if (msg.includes("invalid login credentials")) {
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: data.email,
            password: data.password,
            options: { data: { role: "member" } },
          });

          if (signUpError) {
            const sMsg = String(signUpError.message || "").toLowerCase();
            // "Already registered" here means the account exists and the password
            // was simply wrong — surface that, not a confusing signup error.
            toast.error(
              sMsg.includes("already") || sMsg.includes("registered") || sMsg.includes("exists")
                ? "Invalid credentials. Please check your email and password."
                : signUpError.message || "Could not sign you in."
            );
            return;
          }

          if (signUpData.user) await ensureMemberProfile(signUpData.user);

          // Session-aware: if email confirmation is ON, signUp returns no session,
          // so navigating would bounce. Prompt to confirm instead.
          if (signUpData.session) {
            toast.success("✅ Account created successfully!");
            loginForm.reset();
            // Navigation (incl. any saved QR destination) is handled by the
            // session effect above the instant the session is established.
          } else {
            toast.success("✅ Account created. Please confirm your email, then log in.");
          }
          return;
        }

        toast.error(
          msg.includes("not confirmed")
            ? "Please confirm your email first — check your inbox for the verification link."
            : error.message || "Login failed. Please try again."
        );
        return;
      }

      if (loginData?.user) {
        await ensureMemberProfile(loginData.user);
        toast.success("✅ Welcome back!");
        loginForm.reset();
        // The session effect above performs the redirect (saved QR destination
        // or the member dashboard) once the session is live.
      }
    } catch (err: any) {
      console.error("Member login error:", err);
      toast.error(err?.message || "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    try {
      // Carry any saved QR destination through the OAuth round-trip so the user
      // lands back on /checkin/:id or /join/:id (not just the dashboard).
      const redirectPath = readRedirectParam();
      const dest = isSafeRedirectPath(redirectPath) ? redirectPath : "/member-dashboard";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Dynamic origin so it works in dev, preview and production.
          redirectTo: `${window.location.origin}${dest}`,
        },
      });

      if (error) throw error;
    } catch (err: any) {
      toast.error(`Google login error: ${err.message}`);
      setIsGoogleLoading(false);
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
              <div className="text-center space-y-4">
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Exclusive Member Access</span>
                </motion.div>

                <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                  Member Portal <span className="text-gradient-brand">Login</span>
                </h1>
              </div>

              <div className="space-y-6">
                <Button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isGoogleLoading || isLoading}
                  variant="outline"
                  className="w-full h-14 rounded-xl bg-white/5 border-white/10 text-white font-bold text-lg shadow-sm hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                >
                  {isGoogleLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Chrome className="h-5 w-5 text-[#4285F4]" />
                      Continue with Google
                    </>
                  )}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-transparent px-2 text-muted-foreground font-bold italic">Or continue with</span>
                  </div>
                </div>

                <form className="space-y-6" onSubmit={loginForm.handleSubmit(onLoginSubmit, onLoginInvalid)}>
                  <div className="space-y-4">
                    <div className="space-y-2 group">
                      <Label htmlFor="email" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="email"
                          type="email"
                          {...loginForm.register("email")}
                          placeholder="you@example.com"
                          className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${loginForm.formState.errors.email ? 'border-red-500' : ''}`}
                        />
                      </div>
                      {loginForm.formState.errors.email && <p className="text-xs text-red-500">{loginForm.formState.errors.email.message}</p>}
                    </div>

                    <div className="space-y-2 group">
                      <Label htmlFor="password" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="password"
                          type="password"
                          {...loginForm.register("password")}
                          placeholder="••••••••"
                          className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${loginForm.formState.errors.password ? 'border-red-500' : ''}`}
                        />
                      </div>
                      {loginForm.formState.errors.password && <p className="text-xs text-red-500">{loginForm.formState.errors.password.message}</p>}
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading || isGoogleLoading}
                    className="w-full h-14 rounded-xl bg-gradient-brand text-primary-foreground font-bold text-lg shadow-glow hover:shadow-primary/40 hover:-translate-y-0.5 transition-all group disabled:opacity-70"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="ml-2">Logging in...</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="mr-2 h-5 w-5" />
                        Login / Sign Up
                        <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </>
                    )}
                  </Button>
                </form>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                By logging in, you agree to our{" "}
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
