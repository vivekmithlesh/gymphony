import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Loader2,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  QrCode,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MembershipGate } from "@/components/MembershipGate";
import { buildCheckinUrl } from "@/lib/app-url";
import { saveRedirect, buildAuthUrlWithRedirect } from "@/lib/auth-redirect";
import { logEvent } from "@/lib/logger";

interface GatePlan {
  id: string;
  plan_name: string;
  price: number;
  duration_days: number;
  features?: string[];
}

// Shape of a raw gym_plans row (created manually in the live DB; name/plan_name
// and duration/duration_days are kept as synonyms — see migration 20260618).
interface PlanRow {
  id: string;
  name?: string;
  plan_name?: string;
  price?: number | string;
  duration?: number | string;
  duration_days?: number;
  features?: string[];
}

interface GymBranding {
  id: string;
  gym_name?: string;
  city?: string;
  gym_owner_id?: string;
  upi_id?: string | null;
  terms_url?: string | null;
  privacy_url?: string | null;
  refund_url?: string | null;
  gym_photos?: string[] | null;
}

type Phase = "loading" | "invalid" | "redirecting" | "owner" | "already" | "join";

const ACTIVE = "active";
// select("*") (not an explicit column list) because some branding columns like
// gym_photos were created ad-hoc in the live DB and aren't guaranteed to exist;
// an explicit select of a missing column hard-errors the whole gym lookup.

// =============================================================================
// JoinGymFlow — the destination for the /join/:gymId QR deep-link.
//   1. Load the gym (branding + plans); invalid ids fail gracefully.
//   2. If logged out, save this destination and bounce to member sign-in.
//   3. Link the signed-in member to this gym, then hand off to MembershipGate
//      for plan selection → payment → immediate activation.
// =============================================================================
export function JoinGymFlow({ gymId }: { gymId: string }) {
  const navigate = useNavigate();
  const { session, user, role, isLoading, roleResolved } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [gym, setGym] = useState<GymBranding | null>(null);
  const [plans, setPlans] = useState<GatePlan[]>([]);
  const linkedRef = useRef(false);
  const scanLoggedRef = useRef(false);

  // ── 1. Load gym branding + plans (independent of auth) ─────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: gymRow } = await supabase
        .from("gym_settings")
        .select("*")
        .eq("id", gymId)
        .maybeSingle();

      if (cancelled) return;

      if (!gymRow) {
        logEvent("qr", "join-scan-invalid-gym", { gymId });
        setPhase("invalid");
        return;
      }
      setGym(gymRow as GymBranding);

      const { data: planRows } = await supabase.from("gym_plans").select("*").eq("gym_id", gymId);
      if (cancelled) return;
      setPlans(
        ((planRows ?? []) as PlanRow[]).map((p) => ({
          id: p.id,
          plan_name: p.name || p.plan_name || "Membership",
          price: Number(p.price) || 0,
          duration_days: (Number(p.duration) || 0) * 30 || p.duration_days || 30,
          features: p.features || ["Full Gym Access", "Expert Guidance"],
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  // ── 2. Link the signed-in member to this gym ───────────────────────────────
  const linkMember = useCallback(
    async (gymRow: GymBranding) => {
      if (!user?.id || linkedRef.current) return;
      linkedRef.current = true;
      const fullName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Member";
      try {
        await supabase
          .from("profiles")
          .upsert(
            { id: user.id, gym_id: gymId, full_name: fullName, email: user.email },
            { onConflict: "id" },
          );
        await supabase.from("members").upsert(
          {
            id: user.id,
            gym_id: gymId,
            gym_owner_id: gymRow.gym_owner_id ?? null,
            full_name: fullName,
            email: user.email,
          },
          { onConflict: "id" },
        );
        logEvent("membership", "member-linked-to-gym", { gymId, memberId: user.id });
      } catch (err) {
        logEvent("membership", "member-link-failed", { gymId, error: String(err) });
        toast.error("Could not link you to this gym. Please try again.");
        linkedRef.current = false;
      }
    },
    [user, gymId],
  );

  // ── 3. Auth gate + routing decision (waits for gym + auth to settle) ───────
  useEffect(() => {
    if (isLoading || !gym) return;

    // Logged out → remember where they were headed, then send to member sign-in.
    if (!session) {
      const dest = `/join/${gymId}`;
      saveRedirect(dest);
      logEvent("auth", "redirect-to-login", { from: dest });
      setPhase("redirecting");
      if (typeof window !== "undefined") {
        window.location.assign(buildAuthUrlWithRedirect("/member-login", dest));
      }
      return;
    }

    if (!roleResolved) return;

    // A gym owner is not a member; don't link them as one.
    if (role === "owner") {
      setPhase("owner");
      return;
    }

    // One-time scan audit (now that we know who scanned).
    if (!scanLoggedRef.current && user?.id) {
      scanLoggedRef.current = true;
      logEvent("qr", "join-scan", { gymId, memberId: user.id });
      void supabase.rpc("app_log_qr_scan", {
        p_gym_id: gymId,
        p_source: "join",
        p_result: "scanned",
        p_reason: null,
      });
    }

    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("status, gym_id")
        .eq("id", user!.id)
        .maybeSingle();

      const isActiveHere =
        profile?.gym_id === gymId && (profile?.status ?? "").toLowerCase() === ACTIVE;

      if (isActiveHere) {
        setPhase("already");
        return;
      }

      await linkMember(gym);
      setPhase("join");
    })();
  }, [isLoading, gym, session, role, roleResolved, gymId, user, navigate, linkMember]);

  const heroPhoto = useMemo(() => gym?.gym_photos?.[0] ?? null, [gym]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === "loading" || phase === "redirecting") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-violet-500" />
          <p className="text-sm text-muted-foreground">
            {phase === "redirecting" ? "Taking you to sign in…" : "Loading gym…"}
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === "invalid") {
    return (
      <Shell>
        <Card className="mx-auto max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
            <h2 className="text-xl font-bold">This join link isn't valid</h2>
            <p className="text-sm text-muted-foreground">
              The gym for this QR code could not be found. Ask the front desk for an up-to-date
              code.
            </p>
            <Button variant="outline" className="mt-2" onClick={() => navigate({ to: "/" })}>
              Go home
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (phase === "owner") {
    return (
      <Shell>
        <Card className="mx-auto max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Building2 className="h-12 w-12 text-violet-500" />
            <h2 className="text-xl font-bold">You're signed in as a gym owner</h2>
            <p className="text-sm text-muted-foreground">
              Join links are for members. To test the member experience, use a member account.
            </p>
            <Button
              className="mt-2"
              onClick={() => {
                if (typeof window !== "undefined") window.location.assign("/dashboard");
              }}
            >
              Go to owner dashboard
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (phase === "already") {
    return (
      <Shell>
        <Card className="mx-auto max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <h2 className="text-xl font-bold">
              You're already a member of {gym?.gym_name || "this gym"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Your membership is active. You're all set!
            </p>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1 gap-2"
                onClick={() => navigate({ to: "/member-dashboard" })}
              >
                Open dashboard <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => {
                  // Hard nav so the /checkin route mounts cleanly.
                  if (typeof window !== "undefined") window.location.href = buildCheckinUrl(gymId);
                }}
              >
                <QrCode className="h-4 w-4" /> Check in
              </Button>
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // phase === "join": branded header + the unified checkout gate.
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="relative">
        {heroPhoto ? (
          <div className="h-40 w-full overflow-hidden sm:h-52">
            <img
              src={heroPhoto}
              alt={gym?.gym_name || "Gym"}
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background to-transparent" />
          </div>
        ) : (
          <div className="h-24 w-full bg-gradient-brand/20" />
        )}
        <div className="mx-auto -mt-10 max-w-3xl px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold">{gym?.gym_name || "Welcome"}</h1>
              {gym?.city && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {gym.city}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <MembershipGate
        memberId={user!.id}
        gym={{
          id: gym!.id,
          gym_name: gym!.gym_name,
          gym_owner_id: gym!.gym_owner_id,
          upi_id: gym!.upi_id,
          terms_url: gym!.terms_url,
          privacy_url: gym!.privacy_url,
          refund_url: gym!.refund_url,
        }}
        plans={plans}
        onActivated={() => {
          logEvent("membership", "activated", { gymId, memberId: user!.id });
          toast.success("Membership activated! Welcome in. 💪");
          navigate({ to: "/member-dashboard", replace: true });
        }}
      />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );
}

export default JoinGymFlow;
