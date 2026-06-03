import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LegalLinksFooter } from "@/components/LegalLinksFooter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface StoreUpiCheckoutProps {
  open: boolean;
  onClose: () => void;
  /** Owner's UPI handle from gym_settings.upi_id. */
  upiId?: string | null;
  gymName: string;
  /** Server-computed total (post-discount) for the pending purchase. */
  amount: number;
  itemName: string;
  quantity: number;
  termsUrl?: string | null;
  privacyUrl?: string | null;
  refundUrl?: string | null;
  /** Called when the member confirms they've paid (purchase is already pending). */
  onPaid: () => void;
}

// Store checkout: the pending purchase + reserved stock are already created by
// the initiate_store_purchase RPC, so this dialog only renders the gym's UPI QR
// for the server-computed total and lets the member confirm they've paid. The
// gym owner then approves it. No DB write happens here.
export function StoreUpiCheckout({
  open,
  onClose,
  upiId,
  gymName,
  amount,
  itemName,
  quantity,
  termsUrl,
  privacyUrl,
  refundUrl,
  onPaid,
}: StoreUpiCheckoutProps) {
  // upi://pay?pa={upi}&pn={gym}&am={amount}&cu=INR — the VPA stays literal; only
  // the payee name is encoded (so spaces become %20, not the `+` URLSearchParams
  // would emit). Mirrors MemberUpiCheckout.
  const upiUri = useMemo(() => {
    if (!upiId) return "";
    const pn = encodeURIComponent(gymName || "Gym");
    return `upi://pay?pa=${upiId.trim()}&pn=${pn}&am=${amount}&cu=INR`;
  }, [upiId, gymName, amount]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-violet-500" />
            Pay {gymName || "your gym"}
          </DialogTitle>
          <DialogDescription>
            {quantity}× {itemName} · ₹{amount.toLocaleString("en-IN")}
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

            <a
              href={upiUri}
              className="inline-flex items-center gap-1 text-sm font-semibold text-violet-600 hover:text-violet-700"
            >
              <ExternalLink className="h-4 w-4" /> Open in a UPI app
            </a>

            <Button
              onClick={onPaid}
              className="mt-2 h-12 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-bold text-white hover:from-violet-500 hover:to-fuchsia-500"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />I have paid via UPI
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              The gym confirms your payment, then the item is yours. Your stock is held until then.
            </p>
          </div>
        )}

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

export default StoreUpiCheckout;
