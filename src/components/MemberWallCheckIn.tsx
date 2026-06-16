import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { QrCode, MapPin, CheckCircle2, XCircle, Loader2, Camera } from "lucide-react";
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
import { extractGymIdFromQr } from "@/lib/app-url";

interface MemberWallCheckInProps {
  /** The authenticated member's id (auth.uid()). */
  memberId: string;
  memberName?: string;
  /** Called after a successful (or already-checked-in) check-in so the parent
   *  can refresh self-stats. The realtime subscription also covers this. */
  onCheckedIn?: () => void;
  className?: string;
}

type Phase = "scanning" | "locating" | "submitting" | "success" | "error";

interface WallCheckinResult {
  success: boolean;
  error?: string;
  message?: string;
  distance?: number;
  already_checked_in?: boolean;
}

// Read the gym_id out of the QR payload. The owner's wall QR now encodes the
// deep-link {origin}/checkin/<uuid>; we also accept the legacy {"gym_id":…} JSON
// and a bare uuid string for resilience.
const extractGymId = extractGymIdFromQr;

// Promise wrapper around the HTML5 Geolocation API.
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location is not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

export function MemberWallCheckIn({ memberId, memberName, onCheckedIn, className = "" }: MemberWallCheckInProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [feedback, setFeedback] = useState<string>("");
  const [distance, setDistance] = useState<number | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false); // guards against rapid duplicate decodes

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

  // Core pipeline: decoded QR -> GPS -> secure RPC -> UI state.
  const runCheckIn = useCallback(
    async (decoded: string) => {
      if (processingRef.current) return;
      processingRef.current = true;

      const gymId = extractGymId(decoded);
      if (!gymId) {
        processingRef.current = false;
        toast.error("That QR code isn't a valid gym check-in code.");
        return;
      }

      await stopScanner();

      try {
        setPhase("locating");
        setFeedback("Confirming you're at the gym…");
        const pos = await getCurrentPosition();

        setPhase("submitting");
        setFeedback("Checking you in…");
        const { data, error } = await supabase.rpc("process_wall_checkin", {
          p_member_id: memberId,
          p_gym_id: gymId,
          p_user_lat: pos.coords.latitude,
          p_user_lng: pos.coords.longitude,
        });

        if (error) throw error;
        const result = (data ?? {}) as WallCheckinResult;
        setDistance(typeof result.distance === "number" ? result.distance : null);

        if (result.success) {
          setPhase("success");
          if (result.already_checked_in) {
            setFeedback(result.message || "You're already checked in today.");
            toast.success("You're already checked in. 💪");
          } else {
            setFeedback("You're checked in. Have a great session! 💪");
            toast.success("Checked in successfully! 💪");
          }
          onCheckedIn?.();
          window.setTimeout(() => setIsOpen(false), 1800);
        } else {
          setPhase("error");
          const isGeo = result.error === "Geo-fence validation failed";
          setFeedback(
            isGeo
              ? `You're too far from the gym${
                  typeof result.distance === "number" ? ` (~${Math.round(result.distance)} m away)` : ""
                }. Move closer and try again.`
              : result.message || result.error || "Check-in failed. Please try again."
          );
          toast.error(isGeo ? "Too far from the gym to check in." : result.error || "Check-in failed.");
        }
      } catch (err) {
        setPhase("error");
        const msg =
          err && typeof err === "object" && "code" in err && (err as GeolocationPositionError).code === 1
            ? "Location permission was denied. Enable it to check in."
            : (err as Error)?.message || "Something went wrong. Please try again.";
        setFeedback(msg);
        toast.error("Check-in failed.");
      } finally {
        processingRef.current = false;
      }
    },
    [memberId, onCheckedIn, stopScanner]
  );

  // Start the live camera when the modal opens on the "scanning" phase.
  useEffect(() => {
    if (!isOpen || phase !== "scanning") return;

    const timer = window.setTimeout(async () => {
      if (scannerRef.current) return;
      try {
        const scanner = new Html5Qrcode("wall-checkin-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
          (decodedText) => runCheckIn(decodedText),
          () => {
            /* silent per-frame decode errors */
          }
        );
      } catch (err) {
        console.warn("Wall check-in camera start failed:", err);
        scannerRef.current = null;
        setPhase("error");
        setFeedback("Could not access the camera. Check permissions and try again.");
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [isOpen, phase, runCheckIn]);

  // Always tear the camera down when the dialog closes.
  useEffect(() => {
    if (!isOpen) void stopScanner();
  }, [isOpen, stopScanner]);

  const open = () => {
    processingRef.current = false;
    setDistance(null);
    setFeedback("");
    setPhase("scanning");
    setIsOpen(true);
  };

  const retry = () => {
    processingRef.current = false;
    setDistance(null);
    setFeedback("");
    setPhase("scanning");
  };

  return (
    <>
      <Button
        onClick={open}
        className={`gap-2 bg-linear-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500 ${className}`}
      >
        <QrCode className="h-4 w-4" />
        Scan Gym QR
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-violet-500" />
              Wall Check-in
            </DialogTitle>
            <DialogDescription>
              Point your camera at the gym's QR code to check in. We'll confirm you're on-site.
            </DialogDescription>
          </DialogHeader>

          {phase === "scanning" && (
            <div className="space-y-3">
              <div
                id="wall-checkin-reader"
                className="mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-black"
              />
              <p className="text-center text-xs text-muted-foreground">
                {memberName ? `${memberName}, hold` : "Hold"} steady — scanning…
              </p>
            </div>
          )}

          {(phase === "locating" || phase === "submitting") && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-10 w-10 animate-spin text-violet-500" />
              <p className="text-sm font-medium">{feedback}</p>
              {phase === "locating" && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> Reading your location
                </p>
              )}
            </div>
          )}

          {phase === "success" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <p className="text-base font-semibold">{feedback}</p>
              {distance !== null && (
                <p className="text-xs text-muted-foreground">~{Math.round(distance)} m from the gym</p>
              )}
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <XCircle className="h-14 w-14 text-red-500" />
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{feedback}</p>
              <Button onClick={retry} variant="outline" className="gap-2">
                <QrCode className="h-4 w-4" /> Try again
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default MemberWallCheckIn;
