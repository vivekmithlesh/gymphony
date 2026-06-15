import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, QrCode as QRCodeIcon, Maximize2, X } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { buildMemberPass } from "@/lib/kioskPass";
import { QRService } from "@/lib/qr/QRService";

interface MemberQRCardProps {
  member: {
    id: string;
    full_name?: string;
    short_id?: string;
    avatar_url?: string | null;
    status?: string | null;
    subscription_status?: string | null;
    gym_id?: string | null;
    joined_at?: string | null;
  };
}

// The pass payload (and its inverse, the kiosk parser) lives in @/lib/kioskPass
// so the Virtual ID Card and the Kiosk Scanner can never drift out of sync.

export function MemberQRCard({ member }: MemberQRCardProps) {
  const [qrValue, setQrValue] = useState<string>(() => buildMemberPass(member));
  const [qrReady, setQrReady] = useState(!!member.id);
  const [localFullName, setLocalFullName] = useState(member.full_name || "");
  const [isUpdating, setIsUpdating] = useState(false);
  // Full-screen pass: a member taps the QR (or the header icon) to blow the code
  // up so it's trivial to hold under the kiosk scanner.
  const [showFullscreen, setShowFullscreen] = useState(false);

  useEffect(() => {
    if (member.full_name) {
      setLocalFullName(member.full_name);
    }
  }, [member.full_name]);

  // The pass is now a short-lived, server-SIGNED token (verified by the kiosk
  // RPC). We render a legacy static pass instantly so the card never blanks and
  // still works offline / before the migration is applied, then upgrade to the
  // signed token and keep refreshing it before it expires.
  useEffect(() => {
    if (!member.id) {
      setQrValue("");
      setQrReady(false);
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    setQrValue(buildMemberPass(member));
    setQrReady(true);

    const mint = async () => {
      const pass = await QRService.mintMemberPass();
      if (cancelled || !pass) return; // keep the legacy fallback on failure
      setQrValue(pass.token);
      setQrReady(true);
      const ms = Math.max(30_000, pass.ttl * 1000 - 60_000); // refresh ~1 min early
      refreshTimer = setTimeout(mint, ms);
    };
    mint();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [member.id, member.gym_id, member.short_id]);

  // While the full-screen pass is open: lock body scroll and let Esc dismiss it.
  useEffect(() => {
    if (!showFullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShowFullscreen(false);
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showFullscreen]);

  const formatMemberId = (value: string) => {
    const cleaned = (value || "").replace(/[^a-zA-Z0-9]/g, "");
    const suffix = cleaned.slice(-3).toUpperCase().padStart(3, "0");
    return `GYM-MEMBER-${suffix}`;
  };

  const displayId = member.short_id || formatMemberId(member.id);
  const isActive = (member.status || member.subscription_status || "").toLowerCase() === "active";

  // The day this person joined the gym (distinct from their subscription dates).
  const memberSince = member.joined_at
    ? (() => {
        const d = new Date(member.joined_at);
        return isNaN(d.getTime())
          ? null
          : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      })()
    : null;

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
    <>
    <Card className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden group">
      <CardHeader className="p-6 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-slate-900">Virtual ID Card</CardTitle>
          <button
            type="button"
            onClick={() => qrReady && qrValue && setShowFullscreen(true)}
            disabled={!qrReady || !qrValue}
            aria-label="Show full-screen QR code for scanning"
            className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <QRCodeIcon className="h-4 w-4" />
          </button>
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
          <button
            type="button"
            onClick={() => qrReady && qrValue && setShowFullscreen(true)}
            disabled={!qrReady || !qrValue}
            aria-label="Tap to enlarge QR code for scanning"
            className="relative bg-white p-3 rounded-2xl shadow-sm border border-slate-100 min-h-35 flex items-center justify-center transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-default disabled:hover:scale-100"
          >
            {qrReady && qrValue ? (
              <>
                <QRCodeCanvas
                  value={qrValue}
                  size={150}
                  level="M"
                  includeMargin
                />
                <span className="absolute bottom-1 right-1 h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center shadow-md">
                  <Maximize2 className="h-3 w-3" />
                </span>
              </>
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
          </button>
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
          {memberSince && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs text-slate-500 font-medium">Member Since</span>
              <span className="text-sm font-bold text-slate-900">{memberSince}</span>
            </div>
          )}
          <div className={`p-3 rounded-xl border flex items-center justify-center gap-2 ${isActive ? "bg-emerald-500/5 border-emerald-500/10" : "bg-slate-50 border-slate-200"}`}>
            <span className={`h-2 w-2 rounded-full animate-pulse ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
            <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? "text-emerald-600" : "text-slate-500"}`}>
              DIGITAL ACCESS {isActive ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>

    {showFullscreen && qrReady && qrValue && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Member pass QR code"
        onClick={() => setShowFullscreen(false)}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white/95 backdrop-blur-sm p-6 animate-in fade-in duration-150"
      >
        <button
          type="button"
          onClick={() => setShowFullscreen(false)}
          aria-label="Close"
          className="absolute top-5 right-5 h-11 w-11 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shadow-sm active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">
          Hold up to the scanner
        </p>

        {/* Stop propagation so tapping the code itself doesn't dismiss the overlay. */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white p-5 rounded-3xl shadow-xl border border-slate-100"
        >
          <QRCodeCanvas value={qrValue} size={280} level="M" includeMargin />
        </div>

        <div className="text-center space-y-1">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Member ID</p>
          <p className="text-2xl font-black text-slate-900 tracking-tight font-mono">
            {displayId || "No ID"}
          </p>
          {localFullName && (
            <p className="text-sm font-semibold text-slate-500">{localFullName}</p>
          )}
        </div>

        <p className="text-[11px] text-slate-400 font-medium">Tap anywhere to close</p>
      </div>
    )}
    </>
  );
}
