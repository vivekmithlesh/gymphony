import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, QrCode as QRCodeIcon } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { buildMemberPass } from "@/lib/kioskPass";

interface MemberQRCardProps {
  member: {
    id: string;
    full_name?: string;
    short_id?: string;
    avatar_url?: string | null;
    status?: string | null;
    subscription_status?: string | null;
    gym_id?: string | null;
  };
}

// The pass payload (and its inverse, the kiosk parser) lives in @/lib/kioskPass
// so the Virtual ID Card and the Kiosk Scanner can never drift out of sync.

export function MemberQRCard({ member }: MemberQRCardProps) {
  const [qrValue, setQrValue] = useState<string>(() => buildMemberPass(member));
  const [qrReady, setQrReady] = useState(!!member.id);
  const [localFullName, setLocalFullName] = useState(member.full_name || "");
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (member.full_name) {
      setLocalFullName(member.full_name);
    }
  }, [member.full_name]);

  useEffect(() => {
    const displayId = member.short_id || formatMemberId(member.id);
    setQrValue(buildMemberPass(member));
    setQrReady(!!member.id);
    if (displayId) {
      setLocalFullName(member.full_name || "");
    }
  }, [member.id, member.gym_id, member.short_id]);

  const formatMemberId = (value: string) => {
    const cleaned = (value || "").replace(/[^a-zA-Z0-9]/g, "");
    const suffix = cleaned.slice(-3).toUpperCase().padStart(3, "0");
    return `GYM-MEMBER-${suffix}`;
  };

  const displayId = member.short_id || formatMemberId(member.id);
  const isActive = (member.status || member.subscription_status || "").toLowerCase() === "active";

  const handleNameUpdate = async () => {
    if (!member?.id || localFullName === member.full_name) return;
    if (!localFullName.trim()) {
      toast.error("Name cannot be empty");
      setLocalFullName(member.full_name || "");
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: localFullName.trim() })
        .eq("id", member.id);
      
      if (error) throw error;
      
      toast.success("Name updated successfully!");
      setLocalFullName(localFullName.trim());
    } catch (err) {
      console.error("Update name error:", err);
      toast.error("Failed to update name");
      setLocalFullName(member.full_name || "");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Card className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden group">
      <CardHeader className="p-6 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-slate-900">Virtual ID Card</CardTitle>
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <QRCodeIcon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-2 space-y-6">
        <div className="flex flex-col items-center gap-4 py-4 bg-slate-50 rounded-[2rem] border border-slate-100 shadow-inner">
          <div className="h-20 w-20 rounded-full overflow-hidden border-4 border-white shadow-sm bg-slate-100 flex items-center justify-center">
            {member.avatar_url ? (
              <img src={member.avatar_url} alt={localFullName || "Member"} className="h-full w-full object-cover" />
            ) : (
              <span className="text-lg font-black text-slate-400">{(localFullName || "M").slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 min-h-35 flex items-center justify-center">
            {qrReady && qrValue ? (
              <QRCodeCanvas
                value={qrValue}
                size={150}
                level="M"
                includeMargin
              />
            ) : (
              <div className="w-35 h-35 bg-slate-50 rounded-xl flex items-center justify-center border border-dashed border-slate-200">
                <div className="text-center space-y-2">
                  <QRCodeIcon className="h-8 w-8 text-slate-300 mx-auto" />
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    No ID Found
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="text-center space-y-1">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Member ID</p>
            <p className="text-xl font-black text-slate-900 tracking-tight font-mono">
              {displayId || "No ID"}
            </p>
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 group/input">
            <span className="text-xs text-slate-500 font-medium">Name</span>
            <input
              value={localFullName}
              onChange={(e) => setLocalFullName(e.target.value)}
              onBlur={handleNameUpdate}
              onKeyDown={(e) => e.key === "Enter" && handleNameUpdate()}
              disabled={isUpdating}
              className="bg-transparent border-none focus:outline-none focus:ring-0 p-0 text-sm font-bold text-slate-900 text-right w-full cursor-text placeholder:text-slate-300"
              placeholder="Enter Name"
            />
          </div>
          <div className={`p-3 rounded-xl border flex items-center justify-center gap-2 ${isActive ? "bg-emerald-500/5 border-emerald-500/10" : "bg-slate-50 border-slate-200"}`}>
            <span className={`h-2 w-2 rounded-full animate-pulse ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
            <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? "text-emerald-600" : "text-slate-500"}`}>
              DIGITAL ACCESS {isActive ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
