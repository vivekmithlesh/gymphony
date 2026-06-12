import React, { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { 
  User, 
  Mail, 
  Building2, 
  MapPin, 
  Camera, 
  Loader2, 
  Save,
  CheckCircle2,
  ShieldCheck,
  ArrowLeft,
  Settings
} from "lucide-react";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { isValidInternationalPhone, normalizeToE164Phone } from "@/lib/phone";

interface ProfileSettingsProps {
  member: any;
  gymInfo: any;
  onUpdate: (newData: any) => void;
}

export function ProfileSettings({ member: initialMember, gymInfo, onUpdate }: ProfileSettingsProps) {
  const [member, setMember] = useState(initialMember);
  const [fullName, setFullName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploading, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  // Initial Fetch: Load real data from Supabase
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        if (!user) return;

        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setMember((prev: any) => ({ ...prev, ...data }));
          setFullName(data.full_name || "");
          setWhatsappNumber(data.mobile_number || data.whatsapp_number || "");
          setAvatarUrl(data.avatar_url || null);
        }
      } catch (err) {
        console.error("Profile fetch error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [user?.id]);

  // Sync state if props change (fallback)
  useEffect(() => {
    if (initialMember && !isLoading) {
      setFullName(initialMember.full_name || "");
      setWhatsappNumber(initialMember.mobile_number || initialMember.whatsapp_number || "");
      setAvatarUrl(initialMember.avatar_url || null);
    }
  }, [initialMember, isLoading]);

  const handleUpdateProfile = async () => {
    if (!user?.id) {
      console.log("UPDATE FAILED: No active session found.");
      toast.error("Session Expired", {
        description: "Please login again to update your profile."
      });
      return;
    }
    
    if (!fullName.trim()) {
      toast.error("Name cannot be empty");
      return;
    }

    setIsUpdating(true);
    try {
      const cleanPhone = normalizeToE164Phone(whatsappNumber, "+91");

      if (!cleanPhone || !isValidInternationalPhone(cleanPhone)) {
        toast.error("Please enter a valid international phone number");
        return;
      }
      
      console.log("SYNCING PROFILE FOR USER:", user.id);

      // 1. Upsert profiles table (onConflict: 'id')
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .upsert({ 
          id: user.id,
          full_name: fullName.trim(),
          email: member?.email, 
          mobile_number: cleanPhone,
          phone: cleanPhone,
          avatar_url: avatarUrl
        }, { onConflict: 'id' })
        .select()
        .single();
      
      if (profileError) {
        console.log('UPSERT ERROR (profiles):', profileError.message, 'CODE:', profileError.code);
        
        let errorMessage = "Failed to update profile";
        if (profileError.code === '42703') errorMessage = "Database Error: Column missing";
        if (profileError.code === '42P01') errorMessage = "Database Error: Table not found";
        if (profileError.code === 'PGRST301' || (profileError as any).status === 403) errorMessage = "Permission Denied: RLS Policy Violation";
        
        toast.error(errorMessage);
        throw profileError;
      }

      console.log("PROFILE UPSERT SUCCESS:", profileData);

      // 2. Sync with members table
      const { error: memberError } = await supabase
        .from('members')
        .upsert({ 
          id: user.id,
          full_name: fullName.trim(),
          mobile_number: cleanPhone,
          phone: cleanPhone,
          email: user.email
        }, { onConflict: 'id' });

      if (memberError) {
        console.log('SYNC ERROR (members):', memberError.message, 'CODE:', memberError.code);
      }

      toast.success("Profile Updated Successfully! 🚀");

      // Revalidate: Trigger onUpdate with fresh data
      onUpdate({ 
        ...member,
        full_name: profileData.full_name, 
        whatsapp_number: profileData.whatsapp_number, 
        mobile_number: profileData.mobile_number,
        avatar_url: profileData.avatar_url,
        subscription_status: profileData.subscription_status,
        subscription_end_date: profileData.subscription_end_date
      });
    } catch (err: any) {
      console.error("FATAL PROFILE UPDATE EXCEPTION:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !member?.id) return;

    console.log("File Selected!", file.name);

    // 1. File Type & Size Validation
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid file type", {
        description: "Please upload .jpg, .png, or .webp only."
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("File too large", {
        description: "Image size should be less than 2MB."
      });
      return;
    }

    // 2. Local Preview for instant feedback
    const previewUrl = URL.createObjectURL(file);
    setAvatarUrl(previewUrl);

    setIsUploadingAvatar(true);
    try {
      const fileExt = file.name.split('.').pop();
      // Path format: avatars/${user.id} as requested
      const filePath = `avatars/${member.id}/${Date.now()}.${fileExt}`;

      console.log("Attempting upload to bucket: gym-photos, path:", filePath);

      // 3. Upload to Supabase Storage - using 'gym-photos' bucket
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('gym-photos')
        .upload(filePath, file, { 
          upsert: true,
          contentType: file.type 
        });

      if (uploadError) {
        console.error("FULL STORAGE UPLOAD ERROR:", uploadError);
        throw uploadError;
      }

      console.log("Upload successful, getting public URL...");

      // 4. Get Public URL from 'gym-photos'
      const { data: { publicUrl } } = supabase.storage
        .from('gym-photos')
        .getPublicUrl(filePath);

      console.log("Public URL generated:", publicUrl);

      // 5. Update profiles table with Public URL
      const { error: dbError } = await supabase
        .from('profiles')
        .upsert({ 
          id: member.id,
          avatar_url: publicUrl 
        }, { onConflict: 'id' });

      if (dbError) {
        console.error("FULL DATABASE UPDATE ERROR:", dbError);
        throw dbError;
      }

      setAvatarUrl(publicUrl);
      toast.success("Profile picture updated! 📸");
      
      // Update parent component
      onUpdate({ ...member, avatar_url: publicUrl });
    } catch (err: any) {
      console.error("FATAL AVATAR UPLOAD EXCEPTION:", err);
      // Revert preview on error
      setAvatarUrl(member.avatar_url || null);
      
      let errorMessage = "Failed to update profile picture";
      if (err.message?.includes("bucket")) errorMessage = "Storage Error: 'gym-photos' bucket issue";
      
      toast.error(errorMessage, {
        description: err.message || "Check console for details."
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-100 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-slate-500 font-bold animate-pulse text-sm uppercase tracking-widest">Loading Profile...</p>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-4xl mx-auto pb-20"
    >
      <div className="flex flex-col md:flex-row gap-8">
        {/* Left Column: Avatar & Quick Info */}
        <div className="w-full md:w-1/3 space-y-6">
          <Card className="bg-white/70 backdrop-blur-xl border-white/40 shadow-elegant rounded-[2.5rem] overflow-hidden">
            <CardContent className="p-8 flex flex-col items-center text-center space-y-4">
              <div className="relative group">
                <Avatar className="h-32 w-32 border-4 border-white shadow-xl ring-1 ring-slate-100">
                  <AvatarImage src={avatarUrl || ""} className="object-cover" />
                  <AvatarFallback className="bg-primary/5 text-primary text-3xl font-black">
                    {fullName?.[0]?.toUpperCase() || member?.email?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                
                {/* Hidden File Input */}
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleAvatarUpload} 
                  disabled={isUploading} 
                />

                {/* Interactive Camera Icon Button */}
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-1 right-1 h-10 w-10 bg-primary text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white hover:scale-110 transition-transform cursor-pointer z-10"
                  disabled={isUploading}
                >
                  {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                </button>
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">{fullName || "Member"}</h3>
                <p className="text-sm text-slate-500 font-medium">{member?.email}</p>
              </div>
              <div className="pt-2">
                {(() => {
                  const status = member?.status || "Active";
                  const isExpired = status.toLowerCase() === 'expired' || (member?.subscription_end_date && new Date(member.subscription_end_date) < new Date());
                  const displayStatus = isExpired ? "Expired" : (status === "Active" ? "Active Member" : status);
                  
                  return (
                    <Badge 
                      variant={isExpired ? "destructive" : "success"}
                      className={`px-4 py-1.5 rounded-full font-bold text-[10px] uppercase tracking-widest border-none shadow-sm ${
                        !isExpired && status.toLowerCase() === 'active' ? "bg-emerald-500 text-white" : ""
                      }`}
                    >
                      {displayStatus}
                    </Badge>
                  );
                })()}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/70 backdrop-blur-xl border-white/40 shadow-elegant rounded-[2.5rem]">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-400">Gym Association</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-2 space-y-4">
              <div className="flex items-center gap-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gym Name</p>
                  <p className="text-sm font-bold text-slate-900 truncate">{gymInfo?.gym_name || "No Gym Joined"}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gym Address</p>
                  <p className="text-sm font-bold text-slate-900 truncate">{gymInfo?.address || gymInfo?.city || "N/A"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Edit Form */}
        <div className="flex-1 space-y-6">
          <Card className="bg-white/70 backdrop-blur-xl border-white/40 shadow-elegant rounded-[2.5rem]">
            <CardHeader className="p-8 pb-4">
              <CardTitle className="text-2xl font-black text-slate-900">Personal Details</CardTitle>
              <CardDescription className="text-slate-500 font-medium">Update your public profile and contact information.</CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-4 space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input 
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="pl-12 h-14 rounded-2xl bg-slate-50/50 border-slate-100 focus:ring-primary focus:border-primary text-slate-900 font-bold"
                      placeholder="Enter your full name"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <InternationalPhoneInput
                    id="whatsapp-number"
                    label="WhatsApp Number"
                    value={whatsappNumber}
                    onChange={setWhatsappNumber}
                    placeholder="e.g. +919876543210"
                    defaultCountryCode="+91"
                    error={whatsappNumber && !isValidInternationalPhone(whatsappNumber) ? "Please enter a valid international phone number" : undefined}
                    className="group"
                    inputClassName="bg-slate-50/50 border-slate-200 focus:border-primary focus:ring-primary/5 font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Email Address (Read-only)</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input 
                    value={member?.email || ""}
                    disabled
                    className="pl-12 h-14 rounded-2xl bg-slate-100/50 border-slate-100 text-slate-500 font-medium cursor-not-allowed"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <Button
                  onClick={handleUpdateProfile}
                  disabled={isUpdating || !isValidInternationalPhone(whatsappNumber) || !fullName.trim()}
                  className="w-full h-16 rounded-[2rem] bg-gradient-brand text-white font-black text-lg shadow-glow hover:shadow-primary/40 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  {isUpdating ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span>Saving Profile...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-6 w-6" />
                      <span>Update Profile</span>
                    </div>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Privacy Note */}
          <div className="p-6 bg-primary/5 rounded-3xl border border-primary/10 flex items-start gap-4">
            <div className="h-10 w-10 rounded-2xl bg-white flex items-center justify-center text-primary shadow-sm">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Your privacy is our priority</p>
              <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                Your data is only shared with your gym owner for administration and safety purposes. We never share your personal information with third parties.
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}