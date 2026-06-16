import { useMemo, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { UserPlus, Printer, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildJoinUrl } from "@/lib/app-url";

interface GymJoinQRCodeProps {
  /** The gym's UUID — encoded into the join deep-link. */
  gymId: string | null | undefined;
  gymName?: string | null;
}

// Owner prints this poster at the front desk. It encodes the deep-link
// {origin}/join/<uuid>, so ANY phone camera (no app needed) opens the join page,
// where the prospect signs in, is linked to this gym, and picks a plan + pays.
// Distinct from the Wall Check-in QR (attendance).
export function GymJoinQRCode({ gymId, gymName }: GymJoinQRCodeProps) {
  const payload = useMemo(() => (gymId ? buildJoinUrl(gymId) : ""), [gymId]);
  const qrRef = useRef<HTMLDivElement>(null);

  const downloadPng = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const url = (canvas as HTMLCanvasElement).toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(gymName || "gym").replace(/\s+/g, "-").toLowerCase()}-join-qr.png`;
    a.click();
  };

  const printPoster = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const dataUrl = (canvas as HTMLCanvasElement).toDataURL("image/png");
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`
      <html>
        <head><title>${gymName || "Gym"} — Join QR</title></head>
        <body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;text-align:center;">
          <h1 style="margin:0 0 8px;">${gymName || "Our Gym"}</h1>
          <p style="margin:0 0 24px;font-size:18px;color:#555;">Scan to join &amp; pick your plan</p>
          <img src="${dataUrl}" style="width:320px;height:320px;" />
          <p style="margin:24px 0 0;font-size:14px;color:#888;">Scan with your phone camera — no app needed.</p>
        </body>
      </html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Card className="border-border bg-white shadow-soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <UserPlus className="h-5 w-5 text-violet-500" />
          Join Gym QR
        </CardTitle>
        <CardDescription>
          Print this at the front desk. New members scan it to join your gym and pick a plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6">
        {gymId ? (
          <>
            <div ref={qrRef} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <QRCodeCanvas value={payload} size={240} level="M" includeMargin />
            </div>

            <div className="flex w-full gap-3">
              <Button
                variant="outline"
                className="h-11 flex-1 gap-2 rounded-xl border-slate-200 font-bold"
                onClick={printPoster}
              >
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button
                variant="outline"
                className="h-11 flex-1 gap-2 rounded-xl border-slate-200 font-bold"
                onClick={downloadPng}
              >
                <Download className="h-4 w-4" /> Download
              </Button>
            </div>
          </>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Your gym profile is still loading…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default GymJoinQRCode;
