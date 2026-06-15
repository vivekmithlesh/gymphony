import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, CheckCircle2, Loader2, AlertCircle, ExternalLink, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import { LegalLinksFooter } from "@/components/LegalLinksFooter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface CheckoutPlan {
  plan_name: string;
  price: number;
}

interface MemberUpiCheckoutProps {
  open: boolean;
  onClose: () => void;
  plan: CheckoutPlan | null;
  /** Owner's UPI handle from gym_settings.upi_id. */
  upiId?: string | null;
  gymName: string;
  memberId: string;
  gymId: string;
  gymOwnerId: string;
  /** Owner's legal/compliance URLs — shown in the checkout footer for gateway compliance. */
  termsUrl?: string | null;
  privacyUrl?: string | null;
  refundUrl?: string | null;
  /** Called after a pending payment is recorded. */
  onSubmitted?: () => void;
}

// Zero-fee UPI checkout: the member scans the gym's UPI QR, pays in their own
// UPI app, then taps "I have paid" to log a payment with status
// 'pending_verification' for the owner to approve manually.
export function MemberUpiCheckout({
  open,
  onClose,
  plan,
  upiId,
  gymName,
  memberId,
  gymId,
  gymOwnerId,
  termsUrl,
  privacyUrl,
  refundUrl,
  onSubmitted,
}: MemberUpiCheckoutProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Manual-UPI proof: the member enters the UTR / reference shown in their UPI
  // app, and may optionally attach a screenshot. The UTR is required and the DB
  // enforces it can never be submitted twice.
  const [utr, setUtr] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Clear proof when the dialog is closed so it never leaks into the next plan.
  useEffect(() => {
    if (!open) {
      setUtr("");
      setEvidenceUrl(null);
    }
  }, [open]);

  const handleEvidence = async (file: File) => {
    setIsUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${memberId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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

  // upi://pay?pa={upi}&pn={gym}&am={amount}&cu=INR — the standard UPI deep link
  // every Indian UPI app (GPay, PhonePe, Paytm…) understands. The VPA (`pa`) is
  // kept literal (UPI wants a raw `name@bank`); only the payee name is encoded
  // (so spaces become %20, not the `+` that URLSearchParams would emit).
  const upiUri = useMemo(() => {
    if (!upiId || !plan) return "";
    const pn = encodeURIComponent(gymName || "Gym");
    return `upi://pay?pa=${upiId.trim()}&pn=${pn}&am=${plan.price}&cu=INR`;
  }, [upiId, plan, gymName]);

  const handlePaid = async () => {
    if (!plan) return;
    const ref = utr.trim();
    if (ref.length < 4) {
      toast.error("Enter the UPI reference / UTR number shown in your payment app.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("payments").insert([{
        member_id: memberId,
        gym_id: gymId,
        gym_owner_id: gymOwnerId,
        amount: plan.price,
        plan_name: plan.plan_name,
        status: "pending_verification",
        payment_method: "UPI",
        payment_date: new Date().toISOString(),
        utr: ref,
        evidence_url: evidenceUrl,
      }]);
      if (error) {
        // 23505 = the UTR unique index — this reference was already submitted.
        if ((error as { code?: string }).code === "23505") {
          toast.error("This UPI reference (UTR) has already been submitted.");
          return;
        }
        throw error;
      }

      toast.success("Payment submitted! The gym will confirm it shortly.");
      setUtr("");
      setEvidenceUrl(null);
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      console.error("UPI payment submit failed:", err);
      toast.error(`Could not submit payment: ${err.message || "Please try again."}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-violet-500" />
            Pay {gymName || "your gym"}
          </DialogTitle>
          <DialogDescription>
            {plan ? <>{plan.plan_name} · ₹{plan.price.toLocaleString("en-IN")}</> : "Membership payment"}
          </DialogDescription>
        </DialogHeader>

        {!upiId ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-10 w-10 text-amber-500" />
            <p className="text-sm font-medium text-slate-700">
              This gym hasn't set up UPI payments yet.
            </p>
            <p className="text-xs text-muted-foreground">Please ask the front desk to add their UPI ID.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <QRCodeSVG value={upiUri} size={208} level="M" includeMargin />
            </div>

            <div className="text-center">
              <p className="text-xs text-muted-foreground">Scan with any UPI app, or pay to</p>
              <p className="font-bold text-slate-900">{upiId}</p>
            </div>

            {/* On a phone this opens the UPI app directly. */}
            <a
              href={upiUri}
              className="inline-flex items-center gap-1 text-sm font-semibold text-violet-600 hover:text-violet-700"
            >
              <ExternalLink className="h-4 w-4" /> Open in a UPI app
            </a>

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
                Find this in your UPI app's payment receipt. It lets the gym verify your payment.
              </p>

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
                  }}
                />
              </label>
            </div>

            <Button
              onClick={handlePaid}
              disabled={isSubmitting || isUploading || utr.trim().length < 4}
              className="mt-2 h-12 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-bold text-white hover:from-violet-500 hover:to-fuchsia-500"
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
              ) : (
                <><CheckCircle2 className="mr-2 h-4 w-4" />I have paid via UPI</>
              )}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Your membership activates once the gym verifies this payment.
            </p>
          </div>
        )}

        {/* Compliance footer — gateways require these visible at checkout. */}
        <LegalLinksFooter
          termsUrl={termsUrl}
          privacyUrl={privacyUrl}
          refundUrl={refundUrl}
          className="border-t border-slate-100 pt-3"
        />
      </DialogContent>
    </Dialog>
  );
}

export default MemberUpiCheckout;
