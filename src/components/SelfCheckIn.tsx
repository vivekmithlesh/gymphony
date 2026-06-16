import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  MapPin,
  Building2,
  AlertCircle,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildJoinUrl } from "@/lib/app-url";
import { saveRedirect, buildAuthUrlWithRedirect } from "@/lib/auth-redirect";
import { logEvent } from "@/lib/logger";

type Phase =
  | "loading"
  | "invalid"
  | "redirecting"
  | "owner"
  | "locating"
  | "submitting"
  | "success"
  | "already"
  | "error";

interface CheckinResult {
  success: boolean;
  code?: string;
  error?: string;
  message?: string;
  distance?: number | null;
  already_checked_in?: boolean;
  member_name?: string;
}

// Promise wrapper around the Geolocation API. Resolves null (never rejects) so a
// missing/denied location simply omits coordinates — the server decides whether
// geo is required for this gym.
function getPositionBestEffort(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

// =============================================================================
// SelfCheckIn — the destination for the /checkin/:gymId QR deep-link.
//   1. Load the gym (branding + invalid handling).
//   2. If logged out, save this destination and bounce to member sign-in.
//   3. Read GPS (best-effort) and call app_self_checkin, which verifies active
//      membership, optional geo-fence, and the configurable duplicate window.
// =============================================================================
export function SelfCheckIn({ gymId }: { gymId: string }) {
  const navigate = useNavigate();
  const { session, user, role, isLoading, roleResolved } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [gymName, setGymName] = useState<string>("");
  const [feedback, setFeedback] = useState<string>("");
  const [distance, setDistance] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string>("");
  const ranRef = useRef(false);

  // Core pipeline: GPS → secure RPC → UI state.
  const runCheckIn = useCallback(async () => {
    setErrorCode("");
    setDistance(null);
    setPhase("locating");
    setFeedback("Confirming you're at the gym…");
    const pos = await getPositionBestEffort();

    setPhase("submitting");
    setFeedback("Checking you in…");
    try {
      const { data, error } = await supabase.rpc("app_self_checkin", {
        p_gym_id: gymId,
        p_lat: pos?.lat ?? null,
        p_lng: pos?.lng ?? null,
      });
      if (error) throw error;
      const result = (data ?? {}) as CheckinResult;
      setDistance(typeof result.distance === "number" ? result.distance : null);
      setErrorCode(result.code ?? "");

      if (result.success) {
        logEvent("attendance", result.already_checked_in ? "already-checked-in" : "checked-in", {
          gymId,
          memberId: user?.id,
        });
        if (result.already_checked_in) {
          setPhase("already");
          setFeedback(result.message || "You're already checked in.");
        } else {
          setPhase("success");
          setFeedback("You're checked in. Have a great session! 💪");
        }
      } else {
        logEvent("attendance", "check-in-denied", { gymId, code: result.code });
        setPhase("error");
        setFeedback(result.message || result.error || "Check-in failed. Please try again.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent("attendance", "check-in-error", { gymId, error: message });
      setPhase("error");
      setFeedback(message || "Something went wrong. Please try again.");
    }
  }, [gymId, user?.id]);

  // ── 1. Load gym name (independent of auth) ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("gym_settings")
        .select("id, gym_name")
        .eq("id", gymId)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        logEvent("qr", "checkin-scan-invalid-gym", { gymId });
        setPhase("invalid");
        return;
      }
      setGymName(data.gym_name || "your gym");
    })();
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  // ── 2. Auth gate + kick off the check-in once everything has settled ───────
  useEffect(() => {
    if (isLoading || phase === "invalid") return;

    if (!session) {
      const dest = `/checkin/${gymId}`;
      saveRedirect(dest);
      logEvent("auth", "redirect-to-login", { from: dest });
      setPhase("redirecting");
      if (typeof window !== "undefined") {
        window.location.assign(buildAuthUrlWithRedirect("/member-login", dest));
      }
      return;
    }

    if (!roleResolved) return;

    if (role === "owner") {
      setPhase("owner");
      return;
    }

    // Member + signed in + gym known → run once.
    if (!ranRef.current && gymName) {
      ranRef.current = true;
      logEvent("qr", "checkin-scan", { gymId, memberId: user?.id });
      void runCheckIn();
    }
  }, [
    isLoading,
    session,
    role,
    roleResolved,
    phase,
    gymName,
    gymId,
    user?.id,
    navigate,
    runCheckIn,
  ]);

  const retry = () => {
    ranRef.current = true;
    void runCheckIn();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          {/* Branded header */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4 text-violet-500" />
            <span className="font-semibold text-foreground">{gymName || "Check-in"}</span>
          </div>

          {(phase === "loading" || phase === "redirecting") && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-10 w-10 animate-spin text-violet-500" />
              <p className="text-sm text-muted-foreground">
                {phase === "redirecting" ? "Taking you to sign in…" : "Loading…"}
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

          {(phase === "success" || phase === "already") && (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle2 className="h-16 w-16 text-emerald-500" />
              <p className="text-lg font-semibold">{feedback}</p>
              {distance !== null && (
                <p className="text-xs text-muted-foreground">
                  ~{Math.round(distance)} m from the gym
                </p>
              )}
              <Button className="mt-2 gap-2" onClick={() => navigate({ to: "/member-dashboard" })}>
                Open dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {phase === "invalid" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertCircle className="h-14 w-14 text-amber-500" />
              <p className="text-base font-semibold">This check-in link isn't valid</p>
              <p className="text-sm text-muted-foreground">
                The gym for this QR code could not be found. Ask the front desk for the latest
                poster.
              </p>
              <Button variant="outline" className="mt-2" onClick={() => navigate({ to: "/" })}>
                Go home
              </Button>
            </div>
          )}

          {phase === "owner" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Building2 className="h-14 w-14 text-violet-500" />
              <p className="text-base font-semibold">You're signed in as a gym owner</p>
              <p className="text-sm text-muted-foreground">Check-in is for members.</p>
              <Button
                className="mt-2"
                onClick={() => {
                  if (typeof window !== "undefined") window.location.assign("/dashboard");
                }}
              >
                Go to owner dashboard
              </Button>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <XCircle className="h-14 w-14 text-red-500" />
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{feedback}</p>

              {/* Not a member yet → offer to join. */}
              {(errorCode === "not_member" || errorCode === "inactive") && (
                <Button
                  className="gap-2"
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.href = buildJoinUrl(gymId);
                  }}
                >
                  {errorCode === "inactive" ? "Renew membership" : "Join this gym"}{" "}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}

              {/* Location / transient failures → retry. */}
              {errorCode !== "not_member" && errorCode !== "inactive" && (
                <Button variant="outline" className="gap-2" onClick={retry}>
                  <RotateCcw className="h-4 w-4" /> Try again
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SelfCheckIn;
