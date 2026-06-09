import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { QrCode, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface MemberJoinScannerProps {
  /** Called with the decoded gym_id after a successful scan. */
  onJoined: (gymId: string) => void;
  /** Whether the parent is mid-join (disables re-scan / shows spinner). */
  isJoining?: boolean;
  className?: string;
}

// Read the gym_id out of a Join QR. The owner's poster encodes
// {"action":"join","gym_id":"<uuid>"}; we also accept {"gym_id":"<uuid>"} and a
// bare uuid for resilience against older/check-in posters.
function extractGymId(decoded: string): string | null {
  const text = (decoded || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.gym_id === "string") return parsed.gym_id.trim();
  } catch {
    /* not JSON — fall through */
  }
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid ? uuid[0] : null;
}

// Member-side "Scan to Join": opens the camera, decodes the owner's Join QR, and
// hands the gym_id back to the dashboard, which links the membership and routes
// to plan selection. No GPS — joining isn't geo-fenced (only check-in is).
export function MemberJoinScanner({ onJoined, isJoining = false, className = "" }: MemberJoinScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
      await scanner.clear();
    } catch {
      /* already stopped */
    }
  }, []);

  const handleDecoded = useCallback(
    async (decoded: string) => {
      if (processingRef.current) return;
      const gymId = extractGymId(decoded);
      if (!gymId) {
        toast.error("That QR code isn't a valid gym join code.");
        return;
      }
      processingRef.current = true;
      await stopScanner();
      setIsOpen(false);
      onJoined(gymId);
    },
    [onJoined, stopScanner],
  );

  // Start the live camera when the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(async () => {
      if (scannerRef.current) return;
      try {
        const scanner = new Html5Qrcode("member-join-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
          (decodedText) => handleDecoded(decodedText),
          () => {
            /* silent per-frame decode errors */
          },
        );
      } catch (err) {
        console.warn("Join scanner camera start failed:", err);
        scannerRef.current = null;
        toast.error("Could not access the camera. Check permissions and try again.");
        setIsOpen(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isOpen, handleDecoded]);

  // Tear the camera down whenever the dialog closes.
  useEffect(() => {
    if (!isOpen) void stopScanner();
  }, [isOpen, stopScanner]);

  const open = () => {
    processingRef.current = false;
    setIsOpen(true);
  };

  return (
    <>
      <Button
        onClick={open}
        disabled={isJoining}
        className={`gap-2 bg-gradient-brand text-white shadow-glow ${className}`}
      >
        {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
        Scan to Join
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-violet-500" />
              Scan Gym Join QR
            </DialogTitle>
            <DialogDescription>
              Point your camera at the gym's "Join Gym" QR poster to join and pick a plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div
              id="member-join-reader"
              className="mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-black"
            />
            <p className="text-center text-xs text-muted-foreground">Hold steady — scanning…</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default MemberJoinScanner;
