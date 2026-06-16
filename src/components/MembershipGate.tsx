import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Smartphone,
  Banknote,
  Zap,
  Loader2,
  CheckCircle2,
  Clock,
  ArrowLeft,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LegalLinksFooter } from "@/components/LegalLinksFooter";
import { logEvent } from "@/lib/logger";

interface GatePlan {
  id: string;
  plan_name: string;
  price: number;
  duration_days: number;
  features?: string[];
}

interface GymContext {
  id: string;
  gym_name?: string;
  gym_owner_id?: string;
  upi_id?: string | null;
  terms_url?: string | null;
  privacy_url?: string | null;
  refund_url?: string | null;
}

interface MembershipGateProps {
  memberId: string;
  gym: GymContext;
  plans: GatePlan[];
  /** Called the instant the membership becomes Active (owner approval or mock). */
  onActivated: () => void;
}

type Phase = "select" | "method" | "upi" | "online" | "waiting";
type PayMethod = "Online" | "Cash" | "UPI";

const ACTIVE = "active";

// Full-screen gate shown to a member who has joined a gym (gym_id set) but is not
// yet Active. Handles the unified hybrid checkout (Online / Cash / UPI), the
// "waiting for owner approval" lock, and the realtime + poll auto-unlock. All
// three payment methods reuse the existing payments + approve_payment rails; only
// the "Pay Online" mock self-activates (and only when the gym opts in server-side).
export function MembershipGate({ memberId, gym, plans, onActivated }: MembershipGateProps) {
  const [phase, setPhase] = useState<Phase>("waiting"); // assume waiting until we know
  const [plan, setPlan] = useState<GatePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);
  const activatedRef = useRef(false);

  // Detect activation: profiles has no RLS, so the member can always read their
  // own status. Fire onActivated exactly once.
  const checkActivated = useCallback(async () => {
    if (activatedRef.current) return;
    const { data } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", memberId)
      .maybeSingle();
    if ((data?.status ?? "").toLowerCase() === ACTIVE) {
      activatedRef.current = true;
      logEvent("membership", "activated", { memberId, gymId: gym.id });
      toast.success("Membership activated! Welcome in. 💪");
      onActivated();
    }
  }, [memberId, onActivated, gym.id]);

  // On mount: resume into "waiting" if a pending payment already exists (e.g. a
  // refresh), otherwise start at plan selection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("id, plan_name")
        .eq("member_id", memberId)
        .eq("gym_id", gym.id)
        .eq("status", "pending_verification")
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const existing = data?.[0];
      if (existing) {
        setPendingPaymentId(existing.id);
        setPhase("waiting");
      } else {
        setPhase("select");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId, gym.id]);

  // Realtime + safety poll so the lock lifts the instant the owner approves
  // (payments row -> Success flips profiles.status -> Active).
  useEffect(() => {
    void checkActivated();
    const channel = supabase
      .channel(`membership-gate-${memberId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `member_id=eq.${memberId}` },
        () => void checkActivated(),
      )
      .subscribe();
    const poll = setInterval(() => void checkActivated(), 12_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [memberId, checkActivated]);

  const upiUri = useMemo(() => {
    if (!gym.upi_id || !plan) return "";
    const pn = encodeURIComponent(gym.gym_name || "Gym");
    return `upi://pay?pa=${gym.upi_id.trim()}&pn=${pn}&am=${plan.price}&cu=INR`;
  }, [gym.upi_id, gym.gym_name, plan]);

  // Create the pending payment row shared by all three methods.
  const createPending = useCallback(
    async (method: PayMethod): Promise<string | null> => {
      if (!plan) return null;
      const { data, error } = await supabase
        .from("payments")
        .insert([
          {
            member_id: memberId,
            gym_id: gym.id,
            gym_owner_id: gym.gym_owner_id,
            amount: plan.price,
            plan_name: plan.plan_name,
            status: "pending_verification",
            payment_method: method,
            payment_date: new Date().toISOString(),
          },
        ])
        .select("id")
        .single();
      if (error) {
        logEvent("payment", "pending-create-failed", {
          method,
          gymId: gym.id,
          error: error.message,
        });
        console.error("Pending payment insert failed:", error);
        toast.error(`Could not submit payment: ${error.message || "Please try again."}`);
        return null;
      }
      logEvent("membership", "pending-payment-created", {
        method,
        gymId: gym.id,
        memberId,
        plan: plan.plan_name,
        paymentId: data.id,
      });
      return data.id as string;
    },
    [plan, memberId, gym.id, gym.gym_owner_id],
  );

  const handleCash = async () => {
    setBusy(true);
    const id = await createPending("Cash");
    setBusy(false);
    if (!id) return;
    setPendingPaymentId(id);
    setPhase("waiting");
    toast.success("Request sent! Pay at the desk — the gym will activate you.");
  };

  const handleUpiPaid = async () => {
    setBusy(true);
    const id = await createPending("UPI");
    setBusy(false);
    if (!id) return;
    setPendingPaymentId(id);
    setPhase("waiting");
    toast.success("Payment submitted! The gym will confirm it shortly.");
  };

  // Pay Online: create the pending row, then move to the mock gateway step.
  const startOnline = async () => {
    setBusy(true);
    const id = await createPending("Online");
    setBusy(false);
    if (!id) return;
    setPendingPaymentId(id);
    setPhase("online");
  };

  const simulateOnline = async () => {
    if (!pendingPaymentId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("app_simulate_online_payment", {
        p_payment_id: pendingPaymentId,
      });
      if (error) throw error;
      const result = (data ?? {}) as { success: boolean; error?: string };
      if (!result.success) {
        // Mock disabled for this gym, etc. — fall back to the waiting lock so the
        // owner can still approve manually.
        logEvent("payment", "online-failed", { gymId: gym.id, memberId, reason: result.error });
        toast.error(result.error || "Could not complete the online payment.");
        setPhase("waiting");
        return;
      }
      logEvent("payment", "online-success", {
        gymId: gym.id,
        memberId,
        paymentId: pendingPaymentId,
      });
      await checkActivated();
    } catch (err: any) {
      logEvent("payment", "online-error", {
        gymId: gym.id,
        memberId,
        error: String(err?.message || err),
      });
      console.error("simulate online payment failed:", err);
      toast.error(err?.message || "Online payment failed. Please try Pay at Desk.");
      setPhase("waiting");
    } finally {
      setBusy(false);
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );

  // ── Waiting lock ──────────────────────────────────────────────────────────
  if (phase === "waiting") {
    return (
      <Shell>
        <Card className="border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col items-center gap-5 p-10 text-center">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-glow">
              <Clock className="h-9 w-9" />
              <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/30" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Waiting for the gym to approve your payment…</h2>
            <p className="max-w-md text-muted-foreground">
              {gym.gym_name || "Your gym"} will confirm your payment shortly. This screen unlocks
              automatically the moment they approve — no need to refresh.
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Listening for approval…
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── Online mock gateway ───────────────────────────────────────────────────
  if (phase === "online") {
    return (
      <Shell>
        <Card className="mx-auto max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
            <Zap className="h-12 w-12 text-violet-500" />
            <h2 className="text-xl font-bold">Pay Online</h2>
            <p className="text-sm text-muted-foreground">
              {plan?.plan_name} · ₹{plan?.price.toLocaleString("en-IN")}
            </p>
            <p className="rounded-xl border border-amber-200/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              A real gateway (Razorpay/UPI) will go here. For now, simulate a successful payment to
              activate instantly.
            </p>
            <Button
              onClick={simulateOnline}
              disabled={busy}
              className="h-12 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-bold text-white hover:from-violet-500 hover:to-fuchsia-500"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Simulate Online Payment
            </Button>
            <button
              onClick={() => setPhase("waiting")}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              I'll pay another way — wait for approval
            </button>
            <LegalLinksFooter
              termsUrl={gym.terms_url}
              privacyUrl={gym.privacy_url}
              refundUrl={gym.refund_url}
              className="border-t border-white/10 pt-3"
            />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── UPI checkout ──────────────────────────────────────────────────────────
  if (phase === "upi") {
    return (
      <Shell>
        <Card className="mx-auto max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <button
              onClick={() => setPhase("method")}
              className="self-start text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-1 inline h-3 w-3" /> Back
            </button>
            <h2 className="text-xl font-bold">Pay via UPI</h2>
            <p className="text-sm text-muted-foreground">
              {plan?.plan_name} · ₹{plan?.price.toLocaleString("en-IN")}
            </p>
            {!gym.upi_id ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <AlertCircle className="h-10 w-10 text-amber-500" />
                <p className="text-sm font-medium">This gym hasn't set up UPI yet.</p>
                <p className="text-xs text-muted-foreground">Choose Pay at Desk instead.</p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                  <QRCodeSVG value={upiUri} size={200} level="M" includeMargin />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Scan with any UPI app, or pay to <span className="font-bold text-foreground">{gym.upi_id}</span>
                </p>
                <a
                  href={upiUri}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-violet-500 hover:text-violet-400"
                >
                  <ExternalLink className="h-4 w-4" /> Open in a UPI app
                </a>
                <Button
                  onClick={handleUpiPaid}
                  disabled={busy}
                  className="h-12 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-bold text-white hover:from-violet-500 hover:to-fuchsia-500"
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  I have paid via UPI
                </Button>
              </>
            )}
            <LegalLinksFooter
              termsUrl={gym.terms_url}
              privacyUrl={gym.privacy_url}
              refundUrl={gym.refund_url}
              className="border-t border-white/10 pt-3"
            />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── Payment method chooser ────────────────────────────────────────────────
  if (phase === "method" && plan) {
    return (
      <Shell>
        <Card className="mx-auto max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col gap-4 p-8">
            <button
              onClick={() => setPhase("select")}
              className="self-start text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-1 inline h-3 w-3" /> Change plan
            </button>
            <div className="text-center">
              <h2 className="text-xl font-bold">How would you like to pay?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {plan.plan_name} · ₹{plan.price.toLocaleString("en-IN")} · {plan.duration_days} days
              </p>
            </div>

            <button
              onClick={startOnline}
              disabled={busy}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-60"
            >
              <Zap className="h-6 w-6 shrink-0 text-violet-500" />
              <div>
                <p className="font-bold">Pay Online</p>
                <p className="text-xs text-muted-foreground">Card / UPI gateway — instant activation</p>
              </div>
            </button>

            <button
              onClick={() => setPhase("upi")}
              disabled={busy}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-60"
            >
              <Smartphone className="h-6 w-6 shrink-0 text-fuchsia-500" />
              <div>
                <p className="font-bold">Pay via UPI</p>
                <p className="text-xs text-muted-foreground">Scan the gym's UPI QR, then submit for approval</p>
              </div>
            </button>

            <button
              onClick={handleCash}
              disabled={busy}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-6 w-6 shrink-0 animate-spin text-emerald-500" />
              ) : (
                <Banknote className="h-6 w-6 shrink-0 text-emerald-500" />
              )}
              <div>
                <p className="font-bold">Pay at Desk / Cash</p>
                <p className="text-xs text-muted-foreground">Pay in person — the gym approves your membership</p>
              </div>
            </button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── Plan selection (default) ──────────────────────────────────────────────
  return (
    <Shell>
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Choose your plan</h1>
        <p className="mt-2 text-muted-foreground">
          You've joined {gym.gym_name || "the gym"}. Pick a membership to activate your account.
        </p>
      </div>
      {plans.length === 0 ? (
        <Card className="mx-auto mt-6 max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <AlertCircle className="h-10 w-10 text-amber-500" />
            <p className="text-sm font-medium">This gym hasn't published any plans yet.</p>
            <p className="text-xs text-muted-foreground">Please ask the front desk to add a plan.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className="flex flex-col border-white/10 bg-white/5 backdrop-blur-xl">
              <CardContent className="flex grow flex-col p-6">
                <p className="font-bold">{p.plan_name}</p>
                <p className="mt-2 text-3xl font-black">₹{p.price.toLocaleString("en-IN")}</p>
                <p className="text-sm text-muted-foreground">for {p.duration_days} days</p>
                {p.features && p.features.length > 0 && (
                  <ul className="mt-4 grow space-y-2 text-sm">
                    {p.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  className="mt-6 w-full rounded-xl bg-gradient-brand font-bold text-white shadow-glow"
                  onClick={() => {
                    setPlan(p);
                    setPhase("method");
                  }}
                >
                  Choose Plan
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}

export default MembershipGate;
