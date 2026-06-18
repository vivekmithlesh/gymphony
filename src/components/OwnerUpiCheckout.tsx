import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Smartphone,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Paperclip,
  Copy,
  Check,
  MessageCircle,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import { PLANS, formatINR, type PlanTier, type BillingCycle } from "@/lib/plans";
import { getPlatformUpi, submitSubscriptionPayment, type PlatformUpi } from "@/lib/platform-billing";
import { isValidUtr } from "@/lib/utr";

interface OwnerUpiCheckoutProps {
  open: boolean;
  onClose: () => void;
  tier: PlanTier | null;
  cycle: BillingCycle;
  /** Called after a pending subscription payment is recorded. */
  onSubmitted?: () => void;
}

// Manual-UPI subscription checkout (gym owner → platform). The owner scans the
// PLATFORM's QR (uploaded image, else one generated from the UPI ID), pays in
// their own app, enters the UTR (+ optional screenshot / notes), and submits a
// 'pending_verification' subscription_payment for a platform admin to approve.
// The amount is recomputed server-side.
export function OwnerUpiCheckout({ open, onClose, tier, cycle, onSubmitted }: OwnerUpiCheckoutProps) {
  const { user } = useAuth();
  const [upi, setUpi] = useState<PlatformUpi | null>(null);
  const [loadingUpi, setLoadingUpi] = useState(false);
  const [utr, setUtr] = useState("");
  const [notes, setNotes] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const plan = tier ? PLANS[tier] : null;
  const amount = useMemo(() => {
    if (!plan) return 0;
    return cycle === "yearly" ? plan.priceYearlyTotal : plan.priceMonthly;
  }, [plan, cycle]);

  // Load the platform UPI when opened; clear inputs when closed.
  useEffect(() => {
    if (!open) {
      setUtr("");
      setNotes("");
      setEvidenceUrl(null);
      setCopied(false);
      return;
    }
    let cancelled = false;
    setLoadingUpi(true);
    getPlatformUpi()
      .then((u) => {
        if (!cancelled) setUpi(u);
      })
      .finally(() => {
        if (!cancelled) setLoadingUpi(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const upiUri = useMemo(() => {
    if (!upi?.upi_id || !amount) return "";
    const pn = encodeURIComponent(upi.name || "Gymphony");
    return `upi://pay?pa=${upi.upi_id.trim()}&pn=${pn}&am=${amount}&cu=INR`;
  }, [upi, amount]);

  // We can take a payment if there's a UPI ID (→ generated QR + copy/open) OR an
  // uploaded QR image to scan. Otherwise the owner reaches out via support.
  const canPay = !!(upi?.upi_id || upi?.qr_url);
  const hasSupport = !!(upi?.support_whatsapp || upi?.support_email);
  const waHref = upi?.support_whatsapp
    ? `https://wa.me/${upi.support_whatsapp.replace(/[^0-9]/g, "")}`
    : "";

  const copyUpi = async () => {
    if (!upi?.upi_id) return;
    try {
      await navigator.clipboard.writeText(upi.upi_id.trim());
      setCopied(true);
      toast.success("UPI ID copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — please copy it manually.");
    }
  };

  const handleEvidence = async (file: File) => {
    if (!user?.id) return;
    setIsUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${user.id}/sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("payment-evidence")
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (error) throw error;
      const { data } = supabase.storage.from("payment-evidence").getPublicUrl(path);
      setEvidenceUrl(data.publicUrl);
      toast.success("Proof attached.");
    } catch (err: any) {
      toast.error(`Could not upload proof: ${err.message || "please try again."}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePaid = async () => {
    if (!tier) return;
    if (!isValidUtr(utr)) {
      toast.error("Enter the UPI reference / UTR number from your payment app (12+ digits).");
      return;
    }
    setIsSubmitting(true);
    const res = await submitSubscriptionPayment({ tier, cycle, utr: utr.trim(), evidenceUrl, notes });
    setIsSubmitting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Payment submitted! We'll verify and activate your plan shortly.");
    setUtr("");
    setNotes("");
    setEvidenceUrl(null);
    onSubmitted?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-violet-500" />
            Upgrade to {plan?.name ?? "plan"}
          </DialogTitle>
          <DialogDescription>
            {plan ? <>{plan.name} · {cycle} · {formatINR(amount)}</> : "Subscription payment"}
          </DialogDescription>
        </DialogHeader>

        {loadingUpi ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          </div>
        ) : !canPay ? (
          // No QR / UPI configured yet — offer the support channels instead of a
          // dead end so the owner still has a path to upgrade.
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm font-semibold text-slate-800">Let's get you upgraded</p>
            <p className="text-xs text-muted-foreground">
              Reach out and we'll share payment details and activate your {plan?.name ?? "plan"}.
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {waHref && (
                <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
                  <MessageCircle className="h-4 w-4" /> WhatsApp us
                </a>
              )}
              {upi?.support_email && (
                <a href={`mailto:${upi.support_email}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Mail className="h-4 w-4" /> {upi.support_email}
                </a>
              )}
              {!hasSupport && <p className="text-xs text-muted-foreground">Please contact your Gymphony representative.</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              {upi?.qr_url ? (
                <img src={upi.qr_url} alt="Platform UPI QR" className="h-52 w-52 object-contain" />
              ) : (
                <QRCodeSVG value={upiUri} size={208} level="M" includeMargin />
              )}
            </div>

            <div className="text-center">
              <p className="text-xs text-muted-foreground">Scan with any UPI app, or pay to</p>
              {upi?.upi_id && (
                <div className="mt-1 flex items-center justify-center gap-2">
                  <p className="font-bold text-slate-900">{upi.upi_id}</p>
                  <button
                    type="button"
                    onClick={copyUpi}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy UPI"}
                  </button>
                </div>
              )}
              {upi?.name && <p className="text-xs text-muted-foreground">{upi.name}</p>}
              <p className="mt-1 text-lg font-black text-slate-900">{formatINR(amount)}</p>
            </div>
            {upi?.note && <p className="text-center text-[11px] text-muted-foreground">{upi.note}</p>}

            {upiUri && (
              <a
                href={upiUri}
                className="inline-flex items-center gap-1 rounded-xl bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100"
              >
                <ExternalLink className="h-4 w-4" /> Open UPI app
              </a>
            )}

            <div className="w-full space-y-2 pt-1">
              <label className="text-xs font-semibold text-slate-700">
                UPI reference / UTR number <span className="text-red-500">*</span>
              </label>
              <input
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 412345678901"
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
              <p className="text-[11px] text-muted-foreground">
                From your UPI app's payment receipt — it lets us verify your payment.
              </p>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Notes for our team (optional)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />

              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-violet-600 hover:text-violet-700">
                <Paperclip className="h-4 w-4" />
                {isUploading ? "Uploading…" : evidenceUrl ? "Screenshot attached ✓" : "Attach payment screenshot (optional)"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleEvidence(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            <Button
              onClick={handlePaid}
              disabled={isSubmitting || isUploading || !isValidUtr(utr)}
              className="mt-2 h-12 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-bold text-white hover:from-violet-500 hover:to-fuchsia-500"
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
              ) : (
                <><CheckCircle2 className="mr-2 h-4 w-4" />I have paid via UPI</>
              )}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Your plan activates once we verify this payment.
            </p>

            {hasSupport && (
              <div className="flex items-center justify-center gap-4 border-t border-slate-100 pt-3 text-xs">
                {waHref && (
                  <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:underline">
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                )}
                {upi?.support_email && (
                  <a href={`mailto:${upi.support_email}`} className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:underline">
                    <Mail className="h-3.5 w-3.5" /> Email
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default OwnerUpiCheckout;
