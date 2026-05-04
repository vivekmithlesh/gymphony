import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Settings, 
  Building2, 
  ShieldCheck, 
  Bell, 
  CreditCard, 
  HelpCircle,
  Camera as CameraIcon,
  Save,
  ChevronRight,
  Lock,
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Loader2,
  Monitor,
  Crown,
  CheckCircle2,
  Sparkles,
  Zap,
  Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { initiatePhonePePayment, finalizeUpgrade } from "@/lib/phonepe";
import { hasAccess } from "@/lib/permissions";
import { getGymInitials } from "@/lib/utils";

export function SettingsView({ initialCategory = "Gym Profile" }: { initialCategory?: string }) {
  const [activeCategory, setActiveCategory] = useState(initialCategory);

  // Sync with prop changes (useful for deep linking)
  useEffect(() => {
    if (initialCategory) {
      setActiveCategory(initialCategory);
    }
  }, [initialCategory]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const plansControllerRef = useRef<AbortController | null>(null);
  
  // Plans state
  const [plans, setPlans] = useState<any[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isAddingPlan, setIsAddingPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanPrice, setNewPlanPrice] = useState("");
  const [newPlanDuration, setNewPlanDuration] = useState("");

  // Settings state
  const [settings, setSettings] = useState<any>({
    gym_name: "",
    city: "",
    address: "",
    owner_email: "",
    contact_number: "",
    whatsapp_reminders: true,
    daily_summary_email: false,
    plan_type: "Free",
    plan_status: "Active",
    expiry_date: null,
    logo_url: null
  });
  const [isLoadingSettings, setIsLoadingLoadingSettings] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isProcessingBilling, setIsProcessingBilling] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');

  useEffect(() => {
    // Detect currency
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.startsWith('Asia/Calcutta') || tz.startsWith('Asia/Kolkata')) {
      setCurrency('INR');
    } else {
      setCurrency('USD');
    }
  }, []);

  const handleStartTrial = async () => {
    if (!currentUserId) return;
    setIsProcessingBilling(true);
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      
      const updates = {
        plan_type: "Free",
        plan_status: "Active",
        expiry_date: thirtyDaysFromNow.toISOString()
      };

      const { error } = await supabase
        .from("gym_settings")
        .update(updates)
        .eq("gym_owner_id", currentUserId);

      if (error) throw error;
      
      setSettings({ ...settings, ...updates });
      toast.success("✅ 30-day Free Trial started!");
    } catch (err: any) {
      toast.error(`Trial error: ${err.message}`);
    } finally {
      setIsProcessingBilling(false);
    }
  };

  const handleGetPro = async () => {
    if (currency === 'INR') {
      await handlePhonePe();
    } else {
      await handleStripe();
    }
  };

  const handlePhonePe = async () => {
    if (!currentUserId) return;
    
    await initiatePhonePePayment(
      1999, 
      currentUserId, 
      async () => {
        const success = await finalizeUpgrade(currentUserId);
        if (success) {
          const { data } = await supabase
            .from("gym_settings")
            .select("*")
            .eq("gym_owner_id", currentUserId)
            .single();
          if (data) setSettings(data);
        }
      },
      setIsProcessingBilling
    );
  };

  const handleStripe = async () => {
    const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
    if (!STRIPE_KEY) {
      toast.error("Stripe Key missing.");
      return;
    }

    setIsProcessingBilling(true);
    try {
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(STRIPE_KEY);
      if (!stripe) throw new Error("Stripe failed to load");

      toast.info("Redirecting to Stripe Checkout...");
      setTimeout(async () => {
        await finalizeUpgrade();
      }, 2000);
    } catch (err: any) {
      toast.error(err.message);
      setIsProcessingBilling(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        setCurrentUserId(session.user.id);
        fetchSettings(session.user.id, session.user.email || "");
      }
    };
    init();
  }, []);

  const fetchSettings = async (userId: string, email: string) => {
    setIsLoadingLoadingSettings(true);
    try {
      const { data, error } = await supabase
        .from("gym_settings")
        .select("*")
        .eq("gym_owner_id", userId)
        .single();

      if (error && error.code !== "PGRST116") throw error;

      if (data) {
        setSettings(data);
      } else {
        // Fetch actual gym profile data to use as defaults
        const { data: profileData } = await supabase
          .from("gym_profiles")
          .select("gym_name, city, mobile_number")
          .eq("id", userId)
          .single();

        const defaultSettings = {
          gym_owner_id: userId,
          gym_name: profileData?.gym_name || "",
          city: profileData?.city || "",
          address: "",
          owner_email: email,
          contact_number: profileData?.mobile_number || "",
          whatsapp_reminders: true,
          daily_summary_email: false
        };
        const { data: newData, error: insertError } = await supabase
          .from("gym_settings")
          .insert(defaultSettings)
          .select()
          .single();
        
        if (!insertError && newData) setSettings(newData);
      }
    } catch (err: any) {
      console.warn("Settings fetch error:", err.message);
    } finally {
      setIsLoadingLoadingSettings(false);
    }
  };

  const handleUpdateSettings = async (updates: any) => {
    if (!currentUserId) return;
    
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    
    try {
      setIsSaving(true);
      const { error } = await supabase
        .from("gym_settings")
        .upsert({ 
          ...newSettings, 
          gym_owner_id: currentUserId,
          updated_at: new Date().toISOString()
        })
        .eq("gym_owner_id", currentUserId);

      if (error) throw error;
    } catch (err: any) {
      console.warn("Auto-save error:", err.message);
      if (err.message?.includes('plan_type')) {
        toast.error("Database Schema Mismatch", {
          description: "Run this SQL in Supabase: ALTER TABLE gym_settings ADD COLUMN plan_type TEXT DEFAULT 'Free';",
          duration: 10000
        });
      } else {
        toast.error("Auto-save failed");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!settings.owner_email) {
      toast.error("Owner email not found");
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(settings.owner_email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("✅ Password reset link sent to your email!");
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    }
  };

  const handleSupportEmail = () => {
    const subject = encodeURIComponent("Support Request - Gymphony");
    window.location.href = `mailto:support@gymphony.com?subject=${subject}`;
  };

  const handleSave = async () => {
    await handleUpdateSettings(settings);
    toast.success("✅ Settings saved successfully!");
  };

  const startEditing = (plan: any) => {
    setEditingPlan(plan);
    setNewPlanName(plan.name);
    setNewPlanPrice(String(plan.price));
    setNewPlanDuration(String(plan.duration));
    setIsAddingPlan(false);
  };

  const handleDeletePlan = async (id: string) => {
    if (!confirm("Are you sure you want to delete this plan?")) return;
    try {
      const { error } = await supabase
        .from("gym_plans")
        .delete()
        .eq("id", id);

      if (error) throw error;
      setPlans(plans.filter(p => p.id !== id));
      toast.success("✅ Plan deleted successfully!");
    } catch (error: any) {
      console.warn("Error deleting plan:", error.message);
    }
  };

  useEffect(() => {
    if (activeCategory === "Billing & Plans") {
      fetchPlans();
    }
  }, [activeCategory]);

  const fetchPlans = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    
    // Abort previous request if it's still running
    if (plansControllerRef.current) {
      plansControllerRef.current.abort();
    }
    plansControllerRef.current = new AbortController();

    setIsLoadingPlans(true);
    try {
      const { data, error } = await supabase
        .from("gym_plans")
        .select("*")
        .eq("gym_owner_id", session.user.id)
        .order("created_at", { ascending: true })
        .abortSignal(plansControllerRef.current.signal);

      if (error) {
        if (error.name === 'AbortError') return;
        throw error;
      }
      setPlans(data || []);
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.warn("Failed to load plans:", error.message);
      }
    } finally {
      setIsLoadingPlans(false);
    }
  };

  const handleAddPlan = async () => {
    if (!newPlanName || !newPlanPrice || !newPlanDuration) {
      toast.error("Please fill in all fields");
      return;
    }

    if (!currentUserId) return;

    try {
      const { data, error } = await supabase
        .from("gym_plans")
        .insert([{
          gym_owner_id: currentUserId,
          name: newPlanName,
          price: parseFloat(newPlanPrice),
          duration: parseInt(newPlanDuration),
        }])
        .select()
        .single();

      if (error) throw error;

      setPlans([...plans, data]);
      setNewPlanName("");
      setNewPlanPrice("");
      setNewPlanDuration("");
      setIsAddingPlan(false);
      toast.success("✅ Plan added successfully!");
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  const handleUpdatePlan = async () => {
    if (!editingPlan || !newPlanName || !newPlanPrice || !newPlanDuration) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      const { error } = await supabase
        .from("gym_plans")
        .update({
          name: newPlanName,
          price: parseFloat(newPlanPrice),
          duration: parseInt(newPlanDuration),
        })
        .eq("id", editingPlan.id);

      if (error) throw error;

      setPlans(plans.map(p => p.id === editingPlan.id ? { 
        ...p, 
        name: newPlanName,
        price: parseFloat(newPlanPrice),
        duration: parseInt(newPlanDuration)
      } : p));
      
      setEditingPlan(null);
      setNewPlanName("");
      setNewPlanPrice("");
      setNewPlanDuration("");
      toast.success("✅ Plan updated successfully!");
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  const handleLogoClick = () => {
    if (!isUploadingLogo) fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentUserId) return;

    const mimeToExt: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const ext = mimeToExt[file.type];
    if (!ext) {
      toast.error("Please select a valid image file (JPG, PNG, WebP, or GIF).");
      return;
    }

    setIsUploadingLogo(true);
    try {
      const filePath = `${currentUserId}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("gym-logos")
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("gym-logos")
        .getPublicUrl(filePath);

      const logoUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      await handleUpdateSettings({ logo_url: logoUrl });
      toast.success("✅ Logo updated successfully!", { position: "bottom-center" });
    } catch (err: any) {
      toast.error(`Logo upload failed: ${err.message}`);
    } finally {
      setIsUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const menuItems = [
    { name: "Gym Profile", icon: Building2 },
    { name: "Security", icon: ShieldCheck },
    { name: "Notifications", icon: Bell },
    { name: "Billing & Plans", icon: CreditCard },
    { name: "Help & Support", icon: HelpCircle },
  ];

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="font-display text-3xl font-bold md:text-4xl">
          System <span className="text-gradient-brand">Settings</span>
        </h1>
        <p className="mt-1 text-muted-foreground">
          Manage your gym profile, security, and application preferences.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Navigation Sidebar */}
        <div className="space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.name}
              onClick={() => setActiveCategory(item.name)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                activeCategory === item.name 
                  ? "bg-primary/10 text-primary font-bold border border-primary/20 shadow-sm" 
                  : "text-muted-foreground hover:bg-white hover:text-slate-700"
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon className="h-4 w-4" />
                <span className="text-sm">{item.name}</span>
              </div>
              <ChevronRight className={`h-4 w-4 transition-transform ${activeCategory === item.name ? "rotate-90" : "opacity-30"}`} />
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {activeCategory === "Gym Profile" && (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold text-slate-900">Gym Information</CardTitle>
                      <CardDescription>Update your public profile details.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="flex items-center gap-6">
                        <div className="relative group cursor-pointer" onClick={handleLogoClick}>
                          <div className="h-24 w-24 rounded-3xl bg-gradient-brand flex items-center justify-center font-bold text-3xl text-white shadow-glow overflow-hidden">
                            {settings.logo_url ? (
                              <img
                                src={settings.logo_url}
                                alt="Gym Logo"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span>{getGymInitials(settings.gym_name)}</span>
                            )}
                          </div>
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl">
                            {isUploadingLogo ? (
                              <Loader2 className="h-6 w-6 text-white animate-spin" />
                            ) : (
                              <CameraIcon className="h-6 w-6 text-white" />
                            )}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900">{settings.gym_name || "Your Gym"}</h4>
                          <p className="text-sm text-muted-foreground">{settings.city || "Set your city in the fields below"}</p>
                          <Button 
                            variant="link" 
                            className="p-0 h-auto text-primary text-xs font-bold"
                            onClick={handleLogoClick}
                            disabled={isUploadingLogo}
                          >
                            {isUploadingLogo ? "Uploading..." : "Change Logo"}
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-slate-600">Gym Name</Label>
                          <Input 
                            value={settings.gym_name} 
                            onChange={(e) => handleUpdateSettings({ gym_name: e.target.value })}
                            className="bg-slate-50 border-slate-200 rounded-xl" 
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-600">City</Label>
                          <Input 
                            value={settings.city} 
                            onChange={(e) => handleUpdateSettings({ city: e.target.value })}
                            className="bg-slate-50 border-slate-200 rounded-xl" 
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label className="text-slate-600">Address</Label>
                          <Input 
                            value={settings.address} 
                            onChange={(e) => handleUpdateSettings({ address: e.target.value })}
                            className="bg-slate-50 border-slate-200 rounded-xl" 
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-600">Owner Email</Label>
                          <Input 
                            value={settings.owner_email} 
                            onChange={(e) => handleUpdateSettings({ owner_email: e.target.value })}
                            className="bg-slate-50 border-slate-200 rounded-xl" 
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-600">Contact Number</Label>
                          <Input 
                            value={settings.contact_number} 
                            onChange={(e) => handleUpdateSettings({ contact_number: e.target.value })}
                            className="bg-slate-50 border-slate-200 rounded-xl" 
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold text-slate-900">Kiosk Mode</CardTitle>
                      <CardDescription>Setup a dedicated check-in station for your members.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center gap-4 text-center">
                        <Monitor className="h-10 w-10 text-primary" />
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-900">Launch Fullscreen Kiosk</p>
                          <p className="text-xs text-muted-foreground">Opens the dedicated check-in interface in a new window. Perfect for tablets or front-desk monitors.</p>
                        </div>
                        <Button 
                          onClick={() => window.open('/kiosk', '_blank')}
                          className="w-full rounded-xl bg-slate-900 text-white font-bold h-12 shadow-lg hover:shadow-slate-200 transition-all"
                        >
                          Launch Kiosk Mode
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold text-slate-900">Preferences</CardTitle>
                      <CardDescription>Control your dashboard experience.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {hasAccess(settings.plan_type, 'auto_reminders') ? (
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-slate-900 font-medium">Automatic Reminders</Label>
                            <p className="text-xs text-muted-foreground">Send WhatsApp links automatically when dues are overdue.</p>
                          </div>
                          <Switch 
                            checked={settings.whatsapp_reminders} 
                            onCheckedChange={(checked) => handleUpdateSettings({ whatsapp_reminders: checked })}
                            className="data-[state=checked]:bg-primary" 
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-between opacity-60">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Label className="text-slate-900 font-medium">Automatic Reminders</Label>
                              <Badge className="bg-amber-100 text-amber-700 border-none text-[8px] h-4">PRO</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">WhatsApp reminders are a Pro feature.</p>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setActiveCategory("Billing & Plans")}
                            className="text-primary font-bold text-xs"
                          >
                            <Lock className="h-3 w-3 mr-1" />
                            Unlock
                          </Button>
                        </div>
                      )}
                      <div className="h-px bg-slate-100" />
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-slate-900 font-medium">Daily Summary Email</Label>
                          <p className="text-xs text-muted-foreground">Receive a report of attendance and payments every morning.</p>
                        </div>
                        <Switch 
                          checked={settings.daily_summary_email} 
                          onCheckedChange={(checked) => handleUpdateSettings({ daily_summary_email: checked })}
                          className="data-[state=checked]:bg-primary" 
                        />
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

              {activeCategory === "Security" && (
                <Card className="border-border bg-white shadow-soft">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Lock className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg font-bold text-slate-900">Security Settings</CardTitle>
                    </div>
                    <CardDescription>Manage your password and authentication methods.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                      <p className="text-sm text-slate-600 text-center">
                        For your security, you can reset your password by clicking the button below. A reset link will be sent to <strong>{settings.owner_email}</strong>.
                      </p>
                      <Button 
                        onClick={handlePasswordReset}
                        className="w-full rounded-xl bg-slate-900 text-white font-bold h-12 shadow-lg hover:shadow-slate-200 transition-all"
                      >
                        Send Reset Link
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeCategory === "Help & Support" && (
                <Card className="border-border bg-white shadow-soft">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg font-bold text-slate-900">Contact Support</CardTitle>
                    </div>
                    <CardDescription>Need help? Our team is available 24/7.</CardDescription>
                  </CardHeader>
                    <CardContent className="space-y-4 text-center py-10">
                    <p className="text-muted-foreground">Have questions about Gymphony?</p>
                    <div className="flex flex-col gap-3 max-w-xs mx-auto">
                      {hasAccess(settings.plan_type, 'whatsapp_support') ? (
                        <Button 
                          onClick={() => {
                            const supportPhone = settings.contact_number?.replace(/\D/g, '') || "7906240659";
                            window.open(`https://wa.me/${supportPhone}?text=${encodeURIComponent("Hi, I need support with my gym dashboard.")}`, '_blank');
                          }}
                          className="rounded-xl bg-primary text-white font-bold px-8 shadow-lg shadow-primary/20"
                        >
                          Chat with Us on WhatsApp
                        </Button>
                      ) : (
                        <Button 
                          onClick={() => setActiveCategory("Billing & Plans")}
                          className="rounded-xl bg-amber-500 text-white font-bold px-8 shadow-lg shadow-amber-200 flex items-center justify-center gap-2"
                        >
                          <Crown className="h-4 w-4" />
                          Unlock WhatsApp Support
                        </Button>
                      )}
                      <Button 
                        variant="outline"
                        onClick={handleSupportEmail}
                        className="rounded-xl border-slate-200 text-slate-900 font-bold px-8"
                      >
                        Email Support
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeCategory === "Billing & Plans" && (
                <div className="space-y-8">
                  {/* Current Subscription Status Header */}
                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-soft flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`h-12 w-12 rounded-2xl flex items-center justify-center ${settings.plan_type === 'Pro' ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400'}`}>
                        {settings.plan_type === 'Pro' ? <Crown className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-black text-slate-900">Current Subscription</h3>
                          <Badge className={`rounded-full px-3 py-0.5 border-none font-black text-[10px] uppercase tracking-widest ${
                            settings.plan_type === 'Pro' ? 'bg-primary text-white shadow-glow' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {settings.plan_type === 'Pro' ? 'Active: PRO' : 'Free Trial'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground font-medium mt-0.5">
                          {settings.plan_type === 'Pro' && settings.expiry_date ? (
                            <>Next billing date: <span className="text-slate-900 font-bold">{new Date(settings.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></>
                          ) : (
                            "Upgrade to unlock unlimited members and automation."
                          )}
                        </p>
                      </div>
                    </div>
                    {settings.plan_type !== 'Pro' && (
                      <Button 
                        onClick={handleGetPro}
                        disabled={isProcessingBilling}
                        className="rounded-xl bg-primary text-white font-black px-6 h-12 shadow-glow hover:shadow-primary/30 transition-all"
                      >
                        {isProcessingBilling ? <Loader2 className="h-5 w-5 animate-spin" /> : "Upgrade Now"}
                      </Button>
                    )}
                  </div>

                  {/* Plan Comparison Grid */}
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* Free Plan */}
                    <Card className={`relative border-border shadow-soft overflow-hidden flex flex-col ${settings.plan_type === 'Free' ? 'ring-2 ring-primary border-primary/20' : 'bg-white'}`}>
                      <CardHeader className="pb-4">
                        <CardTitle className="text-xl font-bold text-slate-900">Free Trial</CardTitle>
                        <div className="flex items-baseline gap-1 mt-2">
                          <span className="text-4xl font-black text-slate-900">₹0</span>
                          <span className="text-sm text-muted-foreground font-medium">for 1 month</span>
                        </div>
                        <CardDescription className="pt-2 text-slate-500 leading-relaxed">Everything in Pro. No card required. Cancel anytime.</CardDescription>
                      </CardHeader>

                      <CardContent className="pt-0">
                        <Button 
                          variant="outline" 
                          onClick={handleStartTrial}
                          disabled={isProcessingBilling || settings.plan_type === 'Free' || !!settings.expiry_date}
                          className="w-full h-12 rounded-full border-slate-200 text-slate-900 font-bold hover:bg-slate-50"
                        >
                          {settings.plan_type === 'Free' ? "Currently Active" : "Start Free Trial"}
                        </Button>
                      </CardContent>

                      <CardContent className="flex-grow space-y-4">
                        <div className="space-y-4 pt-4">
                          {[
                            { text: "Up to 100 members", icon: CheckCircle2 },
                            { text: "Smart payments + UPI", icon: CheckCircle2 },
                            { text: "QR attendance", icon: CheckCircle2 },
                            { text: "Live dashboard", icon: CheckCircle2 },
                            { text: "Email support", icon: CheckCircle2 }
                          ].map((feat, i) => (
                            <div key={i} className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                              <div className="h-5 w-5 rounded-full bg-primary/5 flex items-center justify-center">
                                <feat.icon className="h-3 w-3 text-primary shrink-0" />
                              </div>
                              {feat.text}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Pro Plan */}
                    <Card className={`relative border-none shadow-glow overflow-hidden flex flex-col bg-gradient-to-b from-[#1a1a2e] to-[#16213e] text-white ${settings.plan_type === 'Pro' ? 'ring-4 ring-primary/30' : ''}`}>
                      <div className="absolute top-4 right-4">
                        <Badge className="bg-primary text-white border-none text-[10px] font-bold px-3 py-1 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          Most popular
                        </Badge>
                      </div>
                      
                      <CardHeader className="pb-4">
                        <CardTitle className="text-xl font-bold text-white">Pro</CardTitle>
                        <div className="flex items-baseline gap-1 mt-2">
                          <span className="text-4xl font-black text-white">₹1,999</span>
                          <span className="text-sm text-slate-400 font-medium">/ month</span>
                        </div>
                        <CardDescription className="pt-2 text-slate-400 leading-relaxed">For serious gym owners ready to automate and grow.</CardDescription>
                      </CardHeader>
                      
                      <CardContent className="pt-0">
                        {settings.plan_type === 'Pro' ? (
                          <Button 
                            onClick={() => toast.info("Subscription management coming soon!")}
                            className="w-full h-14 rounded-full bg-white text-slate-900 font-black hover:bg-slate-100 transition-all shadow-xl"
                          >
                            Active Subscription
                          </Button>
                        ) : (
                          <Button 
                            onClick={handleGetPro}
                            disabled={isProcessingBilling}
                            className="w-full h-14 rounded-full bg-primary text-white font-black hover:shadow-glow transition-all text-lg"
                          >
                            {isProcessingBilling ? <Loader2 className="h-5 w-5 animate-spin" /> : "Get Pro"}
                          </Button>
                        )}
                      </CardContent>

                      <CardContent className="flex-grow space-y-4">
                        <div className="space-y-4 pt-4">
                          {[
                            { text: "Unlimited members", icon: CheckCircle2 },
                            { text: "Smart payments + auto reminders", icon: CheckCircle2 },
                            { text: "QR attendance + alerts", icon: CheckCircle2 },
                            { text: "Kiosk mode for check-ins", icon: CheckCircle2 },
                            { text: "Inventory & stock management", icon: CheckCircle2 },
                            { text: "Live dashboard & analytics", icon: CheckCircle2 },
                            { text: "City discovery + leaderboard", icon: CheckCircle2 },
                            { text: "Public gym profile page", icon: CheckCircle2 },
                            { text: "Priority WhatsApp support", icon: CheckCircle2 }
                          ].map((feat, i) => (
                            <div key={i} className="flex items-center gap-3 text-sm text-slate-300 font-medium">
                              <div className="h-5 w-5 rounded-full bg-white/10 flex items-center justify-center">
                                <feat.icon className="h-3 w-3 text-primary shrink-0" />
                              </div>
                              {feat.text}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-lg font-bold text-slate-900">Gym Plans</CardTitle>
                        <CardDescription>Manage your membership plans and pricing.</CardDescription>
                      </div>
                      <Button 
                        onClick={() => {
                          if (editingPlan) {
                            setEditingPlan(null);
                            setNewPlanName("");
                            setNewPlanPrice("");
                            setNewPlanDuration("");
                          } else {
                            setIsAddingPlan(!isAddingPlan);
                          }
                        }}
                        className="rounded-xl bg-primary text-white font-bold h-9"
                      >
                        {isAddingPlan || editingPlan ? "Cancel" : <><Plus className="h-4 w-4 mr-2" /> Add Plan</>}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <AnimatePresence>
                        {(isAddingPlan || editingPlan) && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-4 overflow-hidden"
                          >
                            <div className="grid gap-4 sm:grid-cols-3">
                              <div className="space-y-2">
                                <Label className="text-slate-600">Plan Name</Label>
                                <Input 
                                  placeholder="e.g. Pro Monthly" 
                                  value={newPlanName}
                                  onChange={(e) => setNewPlanName(e.target.value)}
                                  className="bg-white border-slate-200 rounded-xl" 
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-slate-600">Price (₹)</Label>
                                <Input 
                                  type="number"
                                  placeholder="2000" 
                                  value={newPlanPrice}
                                  onChange={(e) => setNewPlanPrice(e.target.value)}
                                  className="bg-white border-slate-200 rounded-xl" 
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-slate-600">Duration (Months)</Label>
                                <Input 
                                  type="number"
                                  placeholder="1" 
                                  value={newPlanDuration}
                                  onChange={(e) => setNewPlanDuration(e.target.value)}
                                  className="bg-white border-slate-200 rounded-xl" 
                                />
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button 
                                onClick={editingPlan ? handleUpdatePlan : handleAddPlan}
                                className="rounded-xl bg-gradient-brand text-primary-foreground font-bold px-6"
                              >
                                {editingPlan ? "Update Plan" : "Create Plan"}
                              </Button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="space-y-3">
                        {isLoadingPlans ? (
                          <div className="flex flex-col items-center justify-center py-10 space-y-2">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            <p className="text-sm text-muted-foreground">Loading your plans...</p>
                          </div>
                        ) : plans.length === 0 ? (
                          <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                            <CreditCard className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                            <h4 className="font-bold text-slate-900">No Plans Yet</h4>
                            <p className="text-sm text-muted-foreground">Create your first gym membership plan.</p>
                          </div>
                        ) : (
                          <div className="grid gap-4">
                            {plans.map((plan) => (
                              <div 
                                key={plan.id}
                                className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl hover:border-primary/20 transition-all shadow-sm group"
                              >
                                <div className="flex items-center gap-4">
                                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                    <CreditCard className="h-5 w-5" />
                                  </div>
                                  <div>
                                    <h4 className="font-bold text-slate-900">{plan.name}</h4>
                                    <p className="text-xs text-muted-foreground">
                                      ₹{plan.price.toLocaleString()} • {plan.duration} {plan.duration === 1 ? 'Month' : 'Months'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => startEditing(plan)}
                                    className="h-9 w-9 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/5"
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => handleDeletePlan(plan.id)}
                                    className="h-9 w-9 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeCategory === "Notifications" && (
                <Card className="border-border bg-white shadow-soft py-20">
                  <CardContent className="text-center space-y-3">
                    <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
                      <Settings className="h-6 w-6 animate-spin-slow" />
                    </div>
                    <h3 className="font-bold text-slate-900">{activeCategory} Coming Soon</h3>
                    <p className="text-sm text-muted-foreground">We're fine-tuning these settings for you.</p>
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button 
                  variant="ghost" 
                  className="rounded-xl text-muted-foreground hover:bg-slate-50"
                  onClick={() => currentUserId && fetchSettings(currentUserId, settings.owner_email)}
                >
                  Discard
                </Button>
                <Button 
                  onClick={handleSave} 
                  disabled={isSaving}
                  className="rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow hover:shadow-primary/40 px-8"
                >
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

