import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, ArrowRight, Sparkles, LogIn, Chrome } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Navbar } from "@/components/Navbar";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
// Member-login enforces member-only flow; avoid role fallback logic

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const { session } = useAuth();

  // A signed-in user on this page goes straight to the member dashboard.
  useEffect(() => {
    if (session) {
      navigate({ to: "/member-dashboard", replace: true });
    }
  }, [session, navigate]);

  const ensureMemberProfile = async (user: any) => {
    try {
      console.log("DEBUG: Ensuring member profile for", user.id);
      
      const { data: profileRow, error: profileFetchError } = await supabase
        .from("profiles")
        .select("id, gym_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileFetchError) {
        console.error("DEBUG: Error checking profile:", profileFetchError);
      }

      // 1. Create Profile if missing
      if (!profileRow) {
        console.log("DEBUG: Profile missing, creating default profile...");
        const { error: profileInsertError } = await supabase
          .from("profiles")
          .insert([{
            id: user.id,
            full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Member",
            email: user.email,
              status: "Active",
              role: "member"
          }]);
        
        if (profileInsertError) {
          console.error("DEBUG: Profile insert failed:", profileInsertError);
        }
      }

      // 2. Sync with members table (for owner visibility)
      const { data: existingMember, error: memberFetchError } = await supabase
        .from("members")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (memberFetchError) {
        console.error("DEBUG: Error checking member table:", memberFetchError);
      }

      if (!existingMember) {
        console.log("DEBUG: Member record missing, creating default...");
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
          console.error("DEBUG: Member insert failed:", memberInsertError);
        }
      }
    } catch (err) {
      console.error("DEBUG: Unexpected error in ensureMemberProfile:", err);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter both email and password");
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // If user not found, try signing them up (simple auto-signup flow)
        if (error.message.includes("Invalid login credentials")) {
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                role: "member",
              },
            },
          });

          if (signUpError) throw signUpError;
          
          if (signUpData.user) {
            await ensureMemberProfile(signUpData.user);
            toast.success("✅ Account created successfully!");
            navigate({ to: "/member-dashboard", replace: true });
            return;
          }
        }
        throw error;
      }

      if (data?.user) {
        await ensureMemberProfile(data.user);
        toast.success("✅ Welcome back!");
        navigate({ to: "/member-dashboard", replace: true });
      }
    } catch (err: any) {
      toast.error(`Login error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "http://localhost:8080/member-dashboard",
        },
      });

      if (error) throw error;
    } catch (err: any) {
      toast.error(`Google login error: ${err.message}`);
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <Navbar />
      
      <main className="grow relative flex items-center justify-center px-6 py-12">
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
                  Email Address or Social Login
                </p>
              </div>

              <div className="space-y-6">
                <Button 
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isGoogleLoading || isLoading}
                  variant="outline"
                  className="w-full h-14 rounded-2xl bg-white border-white/60 text-slate-700 font-bold text-lg shadow-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-3"
                >
                  {isGoogleLoading ? (
                    <div className="h-5 w-5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
                  ) : (
                    <>
                      <Chrome className="h-5 w-5 text-[#4285F4]" />
                      Continue with Google
                    </>
                  )}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-transparent px-2 text-muted-foreground font-bold">Or with email</span>
                  </div>
                </div>

                <form className="space-y-4" onSubmit={handleEmailLogin}>
                  <div className="space-y-2 group">
                    <Label htmlFor="email" className="text-sm font-bold text-slate-700 ml-1">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-14 pl-12 bg-white/50 border-white/40 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-2xl text-lg font-medium text-slate-900 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 group">
                    <Label htmlFor="password" className="text-sm font-bold text-slate-700 ml-1">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-14 pl-12 bg-white/50 border-white/40 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-2xl text-lg font-medium text-slate-900 shadow-sm"
                      />
                    </div>
                  </div>

                  <Button 
                    type="submit"
                    disabled={isLoading || isGoogleLoading}
                    className="w-full h-14 rounded-2xl bg-gradient-brand text-white font-bold text-lg shadow-glow hover:shadow-primary/40 transition-all group mt-2"
                  >
                    {isLoading ? (
                      <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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

              <div className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">
                  By logging in, you agree to Gymphony's <br />
                  <a href="#" className="text-slate-900 hover:underline">Terms of Service</a> and <a href="#" className="text-slate-900 hover:underline">Privacy Policy</a>.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
