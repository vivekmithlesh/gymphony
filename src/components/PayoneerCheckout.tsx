import { useEffect, useMemo, useState } from "react";
import {
  Globe2,
  CheckCircle2,
  Loader2,
  Paperclip,
  Copy,
  Check,
  MessageCircle,
  Mail,
  AlertCircle,
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
import { PLANS, type PlanTier, type BillingCycle } from "@/lib/plans";
import { formatUSD, countryName } from "@/lib/intl-pricing";
import {
  getPlatformPayoneer,
  createIntlPayment,
  submitIntlReference,
  type PlatformPayoneer,
  type CreatedIntlPayment,
} from "@/lib/platform-billing";

interface PayoneerCheckoutProps {
  open: boolean;
  onClose: () => void;
  tier: PlanTier | null;
  cycle: BillingCycle;
  /** ISO alpha-2 billing country (non-India). */
  country: string;
  /** Called after a payment reference is submitted. */
  onSubmitted?: () => void;
}

// Manual-Payoneer subscription checkout (international gym owner → platform). On
// open we create a 'pending' payment server-side (the server decides the amount
// from the country tier) and show a payment-reference ID. The owner pays the
// platform's Payoneer, then submits their Payoneer transaction reference (+ optional
// screenshot). A platform admin verifies it; only then does the plan activate.
export function PayoneerCheckout({ open, onClose, tier, cycle, country, onSubmitted }: PayoneerCheckoutProps) {
  const { user } = useAuth();
  const [payoneer, setPayoneer] = useState<PlatformPayoneer | null>(null);
  const [created, setCreated] = useState<CreatedIntlPayment | null>(null);
  const [loading, setLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [payerName, setPayerName] = useState("");
  const [notes, setNotes] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState<"email" | "ref" | null>(null);

  const plan = tier ? PLANS[tier] : null;

  // On open: load the Payoneer payee + create/reuse a pending payment server-side.
  useEffect(() => {
    if (!open) {
      setReference("");
      setPayerName("");
      setNotes("");
      setProofUrl(null);
      setCopied(null);
      setCreated(null);
      setCreateError(null);
      return;
    }
    if (!tier) return;
    let cancelled = false;
    setLoading(true);
    setCreateError(null);
    Promise.all([
      getPlatformPayoneer(),
      createIntlPayment({ tier, country, cycle }),
    ])
      .then(([p, c]) => {
        if (cancelled) return;
        setPayoneer(p);
        setCreated(c);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setCreateError(err?.message || "Could not start checkout. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tier, country, cycle]);

  const amountLabel = useMemo(
    () => (created ? formatUSD(Number(created.amount)) : ""),
    [created]
  );

  const canPay = !!(payoneer?.email || payoneer?.account);
  const hasSupport = !!(payoneer?.support_whatsapp || payoneer?.support_email);
  const waHref = payoneer?.support_whatsapp
    ? `https://wa.me/${payoneer.support_whatsapp.replace(/[^0-9]/g, "")}`
    : "";

  const copy = async (value: string, which: "email" | "ref") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      toast.success("Copied.");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy — please copy it manually.");
    }
  };

  const handleProof = async (file: File) => {
    if (!user?.id) return;
    setIsUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      // Folder MUST start with the owner's uid — payment-evidence bucket insert policy.
      const path = `${user.id}/intl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("payment-evidence")
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (error) throw error;
      const { data } = supabase.storage.from("payment-evidence").getPublicUrl(path);
      setProofUrl(data.publicUrl);
      toast.success("Proof attached.");
    } catch (err: any) {
      toast.error(`Could not upload proof: ${err.message || "please try again."}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!created) return;
    if (!payerName.trim()) {
      toast.error("Enter the name used for the payment so we can verify it.");
      return;
    }
    if (reference.trim().length < 4) {
      toast.error("Enter the Payoneer transaction / reference ID from your receipt.");
      return;
    }
    setIsSubmitting(true);
    const res = await submitIntlReference({
      id: created.id,
      reference: reference.trim(),
      proofUrl,
      notes,
      payerName: payerName.trim(),
    });
    setIsSubmitting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Payment submitted! We'll verify and activate your plan shortly.");
    onSubmitted?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-violet-500" />
            Upgrade to {plan?.name ?? "plan"}
          </DialogTitle>
          <DialogDescription>
            {plan ? (
              <>{plan.name} · {cycle} · {countryName(country)} · {amountLabel || "…"}</>
            ) : (
              "International subscription payment"
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          </div>
        ) : createError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="text-sm font-semibold text-slate-800">Couldn't start checkout</p>
            <p className="text-xs text-muted-foreground">{createError}</p>
          </div>
        ) : !canPay ? (
          // No Payoneer payee configured yet — offer support channels, not a dead end.
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm font-semibold text-slate-800">Let's get you upgraded</p>
            <p className="text-xs text-muted-foreground">
              Reach out and we'll share Payoneer payment details and activate your {plan?.name ?? "plan"}.
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {waHref && (
                <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
                  <MessageCircle className="h-4 w-4" /> WhatsApp us
                </a>
              )}
              {payoneer?.support_email && (
                <a href={`mailto:${payoneer.support_email}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Mail className="h-4 w-4" /> {payoneer.support_email}
                </a>
              )}
              {!hasSupport && <p className="text-xs text-muted-foreground">Please contact your Gymphony representative.</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {/* Payment instructions */}
            <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount</span>
                <span className="text-lg font-black text-slate-900">{amountLabel} <span className="text-xs font-semibold text-muted-foreground">USD</span></span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pay to (Payoneer)</span>
                <span className="min-w-0 text-right">
                  {payoneer?.email ? (
                    <button type="button" onClick={() => copy(payoneer.email, "email")} className="inline-flex items-center gap-1 break-all text-sm font-bold text-slate-900 hover:text-violet-700">
                      {payoneer.email}
                      {copied === "email" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
                    </button>
                  ) : (
                    <span className="text-sm font-bold text-slate-900">{payoneer?.account}</span>
                  )}
                </span>
              </div>
              {payoneer?.email && payoneer?.account && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</span>
                  <span className="text-sm font-semibold text-slate-700">{payoneer.account}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reference ID</span>
                {created && (
                  <button type="button" onClick={() => copy(created.payment_reference_id, "ref")} className="inline-flex items-center gap-1 text-sm font-bold text-violet-700 hover:text-violet-800">
                    {created.payment_reference_id}
                    {copied === "ref" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-violet-400" />}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Add the <span className="font-semibold">Reference ID</span> in your Payoneer payment note so we can match it.
                {payoneer?.note ? ` ${payoneer.note}` : ""}
              </p>
            </div>

            {/* Submit reference */}
            <div className="w-full space-y-2">
              <label className="text-xs font-semibold text-slate-700">
                Name (as used for the payment) <span className="text-red-500">*</span>
              </label>
              <input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="e.g. John Carter"
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />

              <label className="text-xs font-semibold text-slate-700">
                Payoneer transaction / reference ID <span className="text-red-500">*</span>
              </label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="From your Payoneer payment receipt"
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
              <p className="text-[11px] text-muted-foreground">
                It lets us verify your payment and activate your plan.
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
                {isUploading ? "Uploading…" : proofUrl ? "Screenshot attached ✓" : "Attach payment screenshot (optional)"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleProof(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || isUploading || !payerName.trim() || reference.trim().length < 4}
              className="mt-1 h-12 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-bold text-white hover:from-violet-500 hover:to-fuchsia-500"
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
              ) : (
                <><CheckCircle2 className="mr-2 h-4 w-4" />Submit Payment Reference</>
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
                {payoneer?.support_email && (
                  <a href={`mailto:${payoneer.support_email}`} className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:underline">
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

export default PayoneerCheckout;
