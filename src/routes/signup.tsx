import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Building2, Mail, MapPin, Phone, Sparkles, User } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ownerSignupStart } from "@/server/api/auth/owner-signup-start";
import { getRedirectForRole } from "@/lib/session-redirect";
import { currentSession } from "@/server/api/auth/current-session";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  beforeLoad: async () => {
    const session = await currentSession();

    if (session) {
      throw redirect({ to: getRedirectForRole(session.role) });
    }
  },
  head: () => ({
    meta: [
      { title: "Join Gymphony — Start Your Free Trial" },
      {
        name: "description",
        content: "Create your gym account on Gymphony and start growing today.",
      },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [gymName, setGymName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsLoading(true);
      const result = await ownerSignupStart({
        data: {
          ownerName: ownerName.trim(),
          gymName: gymName.trim(),
          city: city.trim(),
          email: email.trim(),
          phone: normalizedPhone,
        },
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      sessionStorage.setItem("ownerSignupPhone", normalizedPhone);
      toast.success(result.message);
      navigate({ to: "/verify-otp" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send OTP");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <main className="flex-grow relative flex items-center justify-center px-6 py-24 md:py-32 overflow-hidden">
        {/* Background orbs for glassmorphism effect */}
        <div className="glow-orb -top-20 left-1/4 h-72 w-72 bg-primary-glow opacity-30" />
        <div className="glow-orb bottom-20 right-1/4 h-96 w-96 bg-primary opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_color-mix(in_oklab,_var(--color-primary-glow)_10%,_transparent),_transparent_70%)]" />

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
              <div className="text-center space-y-2">
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Join the future of gym management</span>
                </motion.div>
                <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                  Create <span className="text-gradient-brand">My Gym</span>
                </h1>
                <p className="text-muted-foreground">
                  Start your 30-day free trial. No credit card required.
                </p>
              </div>

              <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div className="space-y-2 group">
                    <Label
                      htmlFor="ownerName"
                      className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors"
                    >
                      Owner Name
                    </Label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="ownerName"
                        placeholder="e.g. Rahul Sharma"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        className="h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 group">
                    <Label
                      htmlFor="gymName"
                      className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors"
                    >
                      Gym Name
                    </Label>
                    <div className="relative">
                      <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="gymName"
                        placeholder="e.g. Iron Paradise"
                        value={gymName}
                        onChange={(e) => setGymName(e.target.value)}
                        className="h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 group">
                    <Label
                      htmlFor="city"
                      className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors"
                    >
                      City
                    </Label>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="city"
                        placeholder="e.g. Mumbai"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 group">
                    <Label
                      htmlFor="email"
                      className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors"
                    >
                      Email Address
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="owner@yourgym.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 group">
                    <Label
                      htmlFor="mobile"
                      className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors"
                    >
                      Mobile Number
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="mobile"
                        type="tel"
                        placeholder="+91 00000 00000"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-14 rounded-xl bg-gradient-brand text-primary-foreground font-bold text-lg shadow-glow hover:shadow-primary/40 hover:-translate-y-0.5 transition-all group"
                >
                  {isLoading ? "Sending OTP..." : "Create My Gym"}
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  By signing up, you agree to our{" "}
                  <Link to="/" className="underline hover:text-primary">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link to="/" className="underline hover:text-primary">
                    Privacy Policy
                  </Link>
                  .
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
