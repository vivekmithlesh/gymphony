import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Building2, Mail, MapPin, Phone, Sparkles, Loader2, Check, ChevronsUpDown, Lock, Chrome } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/supabase";
import { toast } from "sonner";
import { useState } from "react";
import { getDashboardPathForRole, resolveUserRole } from "@/lib/auth-role";
import { INTERNATIONAL_PHONE_REGEX, cleanPhoneInput, normalizeToE164Phone } from "@/lib/phone";

const signupSchema = z.object({
  gymName: z.string().min(2, "Gym name must be at least 2 characters"),
  city: z.string().min(2, "City must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  mobile: z
    .string()
    .transform((value) => cleanPhoneInput(value))
    .refine((value) => INTERNATIONAL_PHONE_REGEX.test(value), "Please enter a valid international mobile number"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Email or Mobile Number is required"),
  password: z.string().min(1, "Password is required"),
});

type SignupFormValues = z.infer<typeof signupSchema>;
type LoginFormValues = z.infer<typeof loginSchema>;

const readRoleValue = (value: unknown): "member" | "owner" | null => {
  return value === "member" || value === "owner" ? value : null;
};

const INDIAN_CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata", "Surat", 
  "Pune", "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Thane", "Bhopal", 
  "Visakhapatnam", "Pimpri-Chinchwad", "Patna", "Vadodara", "Ghaziabad", "Ludhiana", 
  "Agra", "Nashik", "Faridabad", "Meerut", "Rajkot", "Kalyan-Dombivli", "Vasai-Virar", 
  "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar", "Navi Mumbai", 
  "Allahabad", "Ranchi", "Howrah", "Jabalpur", "Gwalior", "Vijayawada", "Jodhpur", 
  "Madurai", "Raipur", "Kota", "Guwahati", "Chandigarh", "Solapur", "Hubli-Dharwad", 
  "Bareilly", "Moradabad", "Mysore", "Gurgaon", "Aligarh", "Jalandhar", "Tiruchirappalli", 
  "Bhubaneswar", "Salem", "Mira-Bhayandar", "Warangal", "Guntur", "Bhiwandi", 
  "Saharanpur", "Gorakhpur", "Bikaner", "Amravati", "Noida", "Jamshedpur", "Bhilai", 
  "Cuttack", "Firozabad", "Kochi", "Nellore", "Bhavnagar", "Dehradun", "Durgapur", 
  "Asansol", "Rourkela", "Nanded", "Kolhapur", "Ajmer", "Gulbarga", "Jamnagar", 
  "Ujjain", "Loni", "Siliguri", "Jhansi", "Ulhasnagar", "Nellore", "Jammu", 
  "Sangli-Miraj & Kupwad", "Belgaum", "Mangalore", "Ambattur", "Tirunelveli", 
  "Malegaon", "Gaya", "Jalgaon", "Udaipur", "Maheshtala"
].sort();

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login to Gymphony — Owner Center" },
      {
        name: "description",
        content: "Access your Gymphony dashboard and manage your gym efficiently.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");

  // A signed-in user landing on /login is redirected to their dashboard by the
  // global <AuthRedirects/> in __root.tsx — no per-page session check needed.

  const signupForm = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      gymName: "",
      city: "",
      email: "",
      mobile: "",
      password: "",
    },
  });

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const [cityOpen, setCityOpen] = useState(false);

  const onLoginInvalid = () => {
    toast.error("Please enter both email/mobile and password.");
  };

  const onSignupSubmit = async (data: SignupFormValues) => {
    setIsLoading(true);
    try {
      // 1. Create the auth user (role stored in user_metadata).
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { role: "owner" } },
      });

      if (authError) {
        const msg = String(authError.message || "").toLowerCase();
        if (
          msg.includes("already registered") ||
          msg.includes("already in use") ||
          msg.includes("user already")
        ) {
          toast.error("Email already in use. Please log in instead.");
        } else {
          toast.error(authError.message || "Could not create your account.");
        }
        return;
      }

      // 2. Upsert the gym profile (onConflict avoids duplicate-key errors).
      const { error: profileError } = await supabase
        .from("gym_profiles")
        .upsert(
          [
            {
              id: authData.user?.id, // Link profile to auth user
              gym_name: data.gymName,
              city: data.city,
              email: data.email,
              mobile_number: data.mobile,
              role: "owner",
            },
          ],
          { onConflict: "id" }
        );

      if (profileError) {
        if (
          String(profileError.message || "").toLowerCase().includes("duplicate") ||
          String(profileError.code || "").includes("23505")
        ) {
          toast.error("This account already exists. Please log in instead.");
          return;
        }
        toast.error(profileError.message || "Could not set up your gym profile.");
        return;
      }

      toast.success("Account created! Setting up your dashboard…");
      signupForm.reset();
      // onAuthStateChange + <AuthRedirects/> will route to /dashboard; navigate
      // explicitly for an immediate transition. (String target avoids the
      // required-search typing on the literal "/dashboard" route.)
      navigate({ to: getDashboardPathForRole("owner"), replace: true });
    } catch (error: any) {
      toast.error(error?.message || "Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const onLoginSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    try {
      let loginEmail = data.identifier;

      // Allow logging in with an international mobile number: look up the email.
      const normalizedMobile = normalizeToE164Phone(data.identifier, "");
      if (normalizedMobile) {
        const { data: profile, error: profileError } = await supabase
          .from("gym_profiles")
          .select("email")
          .or(`mobile_number.eq.${normalizedMobile},phone.eq.${normalizedMobile}`)
          .maybeSingle();

        if (profileError || !profile?.email) {
          toast.error("No account found with this mobile number.");
          return;
        }
        loginEmail = profile.email;
      }

      const { data: loginData, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: data.password,
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();
        toast.error(
          msg.includes("invalid login credentials")
            ? "Invalid credentials. Please check your email/mobile and password."
            : error.message || "Login failed. Please try again."
        );
        return;
      }

      const user = loginData?.user;
      if (!user) {
        toast.error("Login failed. Please try again.");
        return;
      }

      // Resolve role for the redirect target (profiles first, then full lookup).
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", user.id)
        .maybeSingle();

      const resolvedRole = readRoleValue(profile?.role) ?? (await resolveUserRole(user));
      if (!resolvedRole) {
        toast.error("Unable to determine account role. Please contact support.");
        return;
      }

      toast.success("Logged in successfully!");
      loginForm.reset();
      navigate({ to: getDashboardPathForRole(resolvedRole), replace: true });
    } catch (error: any) {
      toast.error(error?.message || "Login failed. Please try again.");
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
          redirectTo: "http://localhost:8080/dashboard",
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
                  <span>Join the future of gym management</span>
                </motion.div>
                
                <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                  {activeTab === "signup" ? (
                    <>Create <span className="text-gradient-brand">My Gym</span></>
                  ) : (
                    <>Welcome <span className="text-gradient-brand">Back</span></>
                  )}
                </h1>
              </div>

              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/10 p-1 h-12 rounded-xl mb-8">
                  <TabsTrigger value="signup" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">Sign Up</TabsTrigger>
                  <TabsTrigger value="login" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">Log In</TabsTrigger>
                </TabsList>

                <TabsContent value="signup">
                  <form className="space-y-6" onSubmit={signupForm.handleSubmit(onSignupSubmit)}>
                    <div className="space-y-4">
                      <div className="space-y-2 group">
                        <Label htmlFor="gymName" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Gym Name</Label>
                        <div className="relative">
                          <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                          <Input
                            id="gymName"
                            {...signupForm.register("gymName")}
                            placeholder="e.g. Iron Paradise"
                            className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${signupForm.formState.errors.gymName ? 'border-red-500' : ''}`}
                          />
                        </div>
                        {signupForm.formState.errors.gymName && <p className="text-xs text-red-500">{signupForm.formState.errors.gymName.message}</p>}
                      </div>

                      <div className="space-y-2 group">
                        <Label htmlFor="city" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">City</Label>
                        <div className="relative">
                          <Controller
                            name="city"
                            control={signupForm.control}
                            render={({ field }) => (
                              <Popover open={cityOpen} onOpenChange={setCityOpen}>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn(
                                      "w-full h-12 pl-11 justify-between bg-white/5 border-white/10 hover:bg-white/10 hover:text-foreground text-left font-normal rounded-xl transition-all",
                                      !field.value && "text-muted-foreground",
                                      signupForm.formState.errors.city && "border-red-500"
                                    )}
                                  >
                                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                    {field.value || "Select city..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-(--radix-popover-trigger-width) p-0 bg-slate-900 border-white/10 backdrop-blur-xl">
                                  <Command className="bg-transparent">
                                    <CommandInput placeholder="Search city..." className="h-10 text-white" />
                                    <CommandList className="max-h-60 overflow-y-auto">
                                      <CommandEmpty className="text-white/60">No city found.</CommandEmpty>
                                      <CommandGroup className="text-white">
                                        {INDIAN_CITIES.map((city) => (
                                          <CommandItem
                                            key={city}
                                            value={city}
                                            onSelect={(val) => {
                                              signupForm.setValue("city", val, { shouldValidate: true });
                                              setCityOpen(false);
                                            }}
                                            className="text-white hover:bg-white/10 cursor-pointer"
                                          >
                                            <Check className={cn("mr-2 h-4 w-4", field.value === city ? "opacity-100" : "opacity-0")} />
                                            {city}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            )}
                          />
                        </div>
                        {signupForm.formState.errors.city && <p className="text-xs text-red-500">{signupForm.formState.errors.city.message}</p>}
                      </div>

                      <div className="space-y-2 group">
                        <Label htmlFor="email" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Email Address</Label>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                          <Input
                            id="email"
                            type="email"
                            {...signupForm.register("email")}
                            placeholder="owner@yourgym.com"
                            className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${signupForm.formState.errors.email ? 'border-red-500' : ''}`}
                          />
                        </div>
                        {signupForm.formState.errors.email && <p className="text-xs text-red-500">{signupForm.formState.errors.email.message}</p>}
                      </div>

                      <div className="space-y-2 group">
                        <Label htmlFor="mobile" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Mobile Number</Label>
                        <div className="relative">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                          <Input
                            id="mobile"
                            type="tel"
                            {...signupForm.register("mobile")}
                            placeholder="e.g. 9876543210"
                            className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${signupForm.formState.errors.mobile ? 'border-red-500' : ''}`}
                          />
                        </div>
                        {signupForm.formState.errors.mobile && <p className="text-xs text-red-500">{signupForm.formState.errors.mobile.message}</p>}
                      </div>

                      <div className="space-y-2 group">
                        <Label htmlFor="password-signup" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                          <Input
                            id="password-signup"
                            type="password"
                            {...signupForm.register("password")}
                            placeholder="••••••••"
                            className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${signupForm.formState.errors.password ? 'border-red-500' : ''}`}
                          />
                        </div>
                        {signupForm.formState.errors.password && <p className="text-xs text-red-500">{signupForm.formState.errors.password.message}</p>}
                      </div>
                    </div>

                    <Button 
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-14 rounded-xl bg-gradient-brand text-primary-foreground font-bold text-lg shadow-glow hover:shadow-primary/40 hover:-translate-y-0.5 transition-all group disabled:opacity-70"
                    >
                      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <>Create My Gym <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" /></>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="login">
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
                          <Label htmlFor="identifier-login" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Email or Mobile Number</Label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <Input
                              id="identifier-login"
                              {...loginForm.register("identifier")}
                              placeholder="e.g. 9876543210 or owner@gym.com"
                              className={`h-12 pl-11 bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-xl ${loginForm.formState.errors.identifier ? 'border-red-500' : ''}`}
                            />
                          </div>
                          {loginForm.formState.errors.identifier && <p className="text-xs text-red-500">{loginForm.formState.errors.identifier.message}</p>}
                        </div>

                        <div className="space-y-2 group">
                          <Label htmlFor="password-login" className="text-sm font-medium text-foreground/80 group-focus-within:text-primary transition-colors">Password</Label>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <Input
                              id="password-login"
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
                            Log In Now <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                          </>
                        )}
                      </Button>
                    </form>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </motion.div>
      </main>
      
      <Footer />
    </div>
  );
}
