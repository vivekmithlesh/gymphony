import { useMemo, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { QrCode as QrCodeIcon, Printer, Download, MapPin } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildCheckinUrl } from "@/lib/app-url";

interface WallQRTabProps {
  /** The gym's UUID — encoded into the check-in deep-link. */
  gymId: string | null | undefined;
  gymName?: string | null;
  /** Whether latitude/longitude are set — geo-fenced check-in needs them. */
  hasLocation?: boolean;
}

// Dedicated Settings tab. Renders ONLY the static Wall Check-in QR poster plus
// Print and Download actions. The owner prints this once and sticks it on the
// wall; members scan it with their phone camera to check in (active-membership +
// optional geo-fence verified server-side).
export function WallQRTab({ gymId, gymName, hasLocation = true }: WallQRTabProps) {
  const payload = useMemo(() => (gymId ? buildCheckinUrl(gymId) : ""), [gymId]);
  const qrRef = useRef<HTMLDivElement>(null);

  const downloadPng = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const url = (canvas as HTMLCanvasElement).toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(gymName || "gym").replace(/\s+/g, "-").toLowerCase()}-checkin-qr.png`;
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
        <head><title>${gymName || "Gym"} — Check-in QR</title></head>
        <body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;text-align:center;">
          <h1 style="margin:0 0 8px;">${gymName || "Our Gym"}</h1>
          <p style="margin:0 0 24px;font-size:18px;color:#555;">Scan to check in</p>
          <img src="${dataUrl}" style="width:320px;height:320px;" />
          <p style="margin:24px 0 0;font-size:14px;color:#888;">Scan with your phone camera to check in — no app needed.</p>
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
          <QrCodeIcon className="h-5 w-5 text-violet-500" />
          Wall Check-in QR
        </CardTitle>
        <CardDescription>
          Print this poster and stick it on your wall. Members scan it from their phone to check in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6">
        {gymId ? (
          <>
            <div ref={qrRef} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <QRCodeCanvas value={payload} size={240} level="M" includeMargin />
            </div>

            {!hasLocation && (
              <div className="flex w-full items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Set your gym's location in <strong>Settings → Gym Profile</strong> to enable
                  geo-fenced check-ins. Without it, members can't verify they're on-site.
                </span>
              </div>
            )}

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

export default WallQRTab;
