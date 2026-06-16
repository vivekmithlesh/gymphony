import { useMemo, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { QrCode as QRCodeIcon, Printer, Download, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildCheckinUrl } from "@/lib/app-url";

interface GymWallQRCodeProps {
  gymId: string | null | undefined;
  gymName?: string | null;
  /** Whether the gym has set latitude/longitude — geo-fencing needs it. */
  hasLocation?: boolean;
}

// The owner prints this static poster. It encodes the deep-link
// {origin}/checkin/<uuid>, so any member can scan it with their phone camera and
// check in (active-membership + optional geo-fence verified server-side).
export function GymWallQRCode({ gymId, gymName, hasLocation = true }: GymWallQRCodeProps) {
  const payload = useMemo(() => (gymId ? buildCheckinUrl(gymId) : ""), [gymId]);
  const printRef = useRef<HTMLDivElement>(null);

  const downloadPng = () => {
    const canvas = printRef.current?.querySelector("canvas");
    if (!canvas) return;
    const url = (canvas as HTMLCanvasElement).toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(gymName || "gym").replace(/\s+/g, "-").toLowerCase()}-checkin-qr.png`;
    a.click();
  };

  const printPoster = () => {
    const canvas = printRef.current?.querySelector("canvas");
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QRCodeIcon className="h-5 w-5 text-violet-500" />
          Wall Check-in QR
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {gymId ? (
          <>
            <div ref={printRef} className="rounded-2xl bg-white p-4 shadow-sm">
              <QRCodeCanvas value={payload} size={220} level="M" includeMargin />
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Print this and stick it on your wall. Members scan it from their phone to check in —
              attendance updates here live.
            </p>

            {!hasLocation && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-left text-xs text-amber-700 dark:text-amber-300">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Set your gym's location in <strong>Settings → Gym Profile</strong> to enable geo-fenced
                  check-ins. Without it, members can't verify they're on-site.
                </span>
              </div>
            )}

            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={printPoster}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button variant="outline" className="flex-1 gap-2" onClick={downloadPng}>
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

export default GymWallQRCode;
