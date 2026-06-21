import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Mail, Lock, ArrowRight, Sparkles, LogIn, Loader2 } from "lucide-react";
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
import { postAuthDestination } from "@/lib/auth-redirect";
import { ensureMemberProfile } from "@/lib/member-signup";
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

  const onLoginSubmit = async (data: MemberLoginFormValues) => {
    setIsLoading(true);
    try {
      const { data: loginData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();

        // SECURITY: the Login button must NEVER create an account. Supabase
        // returns the same "invalid login credentials" for both "no such
        // account" and "wrong password" (deliberate anti-enumeration), so we
        // surface one honest message that points unregistered users at signup
        // WITHOUT auto-provisioning a new auth user.
        if (msg.includes("invalid login credentials")) {
          toast.error("No account found, or the password is incorrect. Please sign up first if you’re new.");
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
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Password</Label>
                        <Link
                          to="/forgot-password"
                          className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          Forgot password?
                        </Link>
                      </div>
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
                    disabled={isLoading}
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
                        Login
                        <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </>
                    )}
                  </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground">
                  Don’t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/member-signup" })}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Sign up
                  </button>
                </p>
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
