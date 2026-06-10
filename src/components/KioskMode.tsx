import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  QrCode,
  ScanLine,
  Camera,
  MapPin,
  Loader2,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/supabase';
import { evaluatePassPreLookup, evaluateMember } from '@/lib/kioskPass';

interface CheckIn {
  id: string;
  check_in_time: string;
  status?: string;
  members: {
    full_name: string;
    membership_plan: string;
    status: string;
  };
}

type KioskTab = 'wall' | 'scanner';

const MODE_STORAGE_KEY = 'gymphony.kioskMode';

function readInitialMode(): KioskTab {
  if (typeof window === 'undefined') return 'wall';
  return window.localStorage.getItem(MODE_STORAGE_KEY) === 'scanner' ? 'scanner' : 'wall';
}

export function KioskMode() {
  const navigate = useNavigate();

  // ── UI / clock ────────────────────────────────────────────────────────────
  const [time, setTime] = useState(new Date());
  const [mode, setMode] = useState<KioskTab>(readInitialMode);

  // ── Gym identity (resolved once on mount) ───────────────────────────────────
  const [gymId, setGymId] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string>('');
  const [hasLocation, setHasLocation] = useState(true);
  const [isResolvingGym, setIsResolvingGym] = useState(true);
  const [isAuthed, setIsAuthed] = useState(true);

  // ── Check-in feed ───────────────────────────────────────────────────────────
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);

  // ── Scanner state (only used in scanner mode) ───────────────────────────────
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [successMember, setSuccessMember] = useState<{ name: string; granted: boolean } | null>(null);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false); // survives the scanner callback closure
  const ownerIdRef = useRef<string | null>(null);
  const gymIdRef = useRef<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkInControllerRef = useRef<AbortController | null>(null);

  // The wall poster encodes {"gym_id":"<uuid>"} — the exact payload the member's
  // "Scan Gym QR" flow (MemberWallCheckIn) decodes before the geo-fenced RPC.
  const wallPayload = gymId ? JSON.stringify({ gym_id: gymId }) : '';

  // ── Persist the chosen mode ──────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  // ── Live clock ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Resolve owner + gym, load recent check-ins, subscribe to realtime ────────
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    const setup = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const ownerId = session?.user?.id ?? null;
        ownerIdRef.current = ownerId;

        if (!ownerId) {
          if (active) {
            setIsAuthed(false);
            setIsResolvingGym(false);
          }
          return;
        }

        const { data: gym } = await supabase
          .from('gym_settings')
          .select('id, gym_name, latitude, longitude')
          .eq('gym_owner_id', ownerId)
          .maybeSingle();

        if (active) {
          gymIdRef.current = gym?.id ?? null;
          setGymId(gym?.id ?? null);
          setGymName(gym?.gym_name ?? '');
          setHasLocation(gym?.latitude != null && gym?.longitude != null);
          setIsResolvingGym(false);
        }
      } catch (e) {
        console.warn('Kiosk owner/gym resolution failed:', e);
        if (active) setIsResolvingGym(false);
      }

      await fetchInitialCheckIns();

      // Subscribe ONLY to this gym's check-ins — no cross-gym triggers.
      const scopedGymId = gymIdRef.current;
      channel = supabase
        .channel('kiosk_check_ins')
        .on(
          'postgres_changes',
          scopedGymId
            ? { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `gym_id=eq.${scopedGymId}` }
            : { event: 'INSERT', schema: 'public', table: 'check_ins' },
          async (payload) => {
            const { data, error } = await supabase
              .from('check_ins')
              .select('id, check_in_time, status, members(full_name, membership_plan, status)')
              .eq('id', payload.new.id)
              .single();
            if (!error && data) setCheckIns((prev) => [data as any, ...prev].slice(0, 8));
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // ── Scanner lifecycle — only runs in scanner mode ────────────────────────────
  useEffect(() => {
    if (mode !== 'scanner') return;

    let cancelled = false;
    setCameraError(null);

    const timer = setTimeout(async () => {
      if (scannerRef.current || cancelled) return;
      try {
        const html5Qrcode = new Html5Qrcode('reader');
        scannerRef.current = html5Qrcode;
        await html5Qrcode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decodedText) => handleCheckIn(decodedText),
          () => { /* silent per-frame decode errors */ }
        );
      } catch (err) {
        console.warn('Kiosk camera start failed:', err);
        scannerRef.current = null;
        if (!cancelled) {
          setCameraError(
            'Could not access a camera. Connect/allow a camera and retry, or switch to Wall QR mode.'
          );
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (scannerRef.current) {
        // Html5Qrcode must be stopped before its DOM is cleared.
        scannerRef.current.stop().then(() => scannerRef.current?.clear()).catch(() => {});
        scannerRef.current = null;
      }
    };
    // handleCheckIn is stable (operates through refs); we intentionally rebind
    // the scanner only when the mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleCheckIn = async (decodedText: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);

    // Local helper: any clean rejection looks the same to the kiosk operator —
    // red overlay + deny beep + toast — so we never silently swallow a scan.
    const reject = (overlayLabel: string, message: string) => {
      toast.error(message);
      playBeep(440);
      showSuccessOverlay(overlayLabel, false);
    };

    try {
      const kioskGymId = gymIdRef.current;

      // Pre-DB ruling: unlinked kiosk, non-member QR, or a pass openly bound to
      // another gym — all settled from the QR + kiosk identity alone.
      const pre = evaluatePassPreLookup(decodedText, kioskGymId);
      if (pre.kind === 'reject') {
        reject(pre.overlayLabel, pre.message);
        return;
      }

      const { data: member, error: memberError } = await supabase
        .from('members')
        .select('id, full_name, status, gym_id, gym_owner_id')
        .eq('id', pre.memberId)
        .maybeSingle();

      // Post-DB ruling: not-found, the cross-gym ownership guard (members has no
      // gym-scoped RLS, so this is the real guard — keyed on gym_owner_id), and
      // the access status.
      const decision = evaluateMember(member ?? null, !!memberError, ownerIdRef.current);
      if (decision.kind === 'reject') {
        reject(decision.overlayLabel, decision.message);
        return;
      }

      const { member: checkedInMember, status: accessStatus } = decision;

      const { error: checkInError } = await supabase.from('check_ins').insert([
        {
          member_id: checkedInMember.id,
          gym_id: kioskGymId,
          status: accessStatus,
          check_in_time: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ]);
      if (checkInError) throw checkInError;

      await supabase.from('activity_log').insert([
        {
          gym_owner_id: ownerIdRef.current,
          activity_type: 'member',
          description: `${checkedInMember.full_name} checked in via Kiosk (${accessStatus}).`,
          is_read: false,
        },
      ]);

      if (accessStatus === 'granted') {
        toast.success(`Welcome, ${checkedInMember.full_name}! Checked in successfully`);
        playBeep(880);
      } else {
        toast.error(`Access Denied — ${checkedInMember.full_name} (${checkedInMember.status})`);
        playBeep(440);
      }
      showSuccessOverlay(checkedInMember.full_name ?? 'Member', accessStatus === 'granted');
    } catch (error: any) {
      console.warn('Kiosk check-in error:', error);
      toast.error('Check-in failed. Please try again.');
    } finally {
      setIsProcessing(false);
      // Cooldown so the live camera can't spam-log the same member.
      setTimeout(() => { isProcessingRef.current = false; }, 4000);
    }
  };

  const showSuccessOverlay = (name: string, granted: boolean) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessMember({ name, granted });
    successTimerRef.current = setTimeout(() => setSuccessMember(null), 3000);
  };

  const playBeep = (frequency: number) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch (e) {
      console.warn('Could not play beep sound', e);
    }
  };

  const fetchInitialCheckIns = useCallback(async () => {
    if (checkInControllerRef.current) checkInControllerRef.current.abort();
    checkInControllerRef.current = new AbortController();

    try {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, check_in_time, status, members(full_name, membership_plan, status)')
        .order('check_in_time', { ascending: false })
        .limit(8)
        .abortSignal(checkInControllerRef.current.signal);

      if (error) {
        if (
          error.name === 'AbortError' ||
          error.message?.includes('abort') ||
          error.message?.includes('Lock broken')
        ) {
          return;
        }
        console.warn('Initial check-ins fetch error:', error.message);
        return;
      }
      setCheckIns((data as any) || []);
    } catch (error: any) {
      if (error.name !== 'AbortError') console.warn('Silent fetch error in fetchInitialCheckIns:', error);
    }
  }, []);

  const retryScanner = () => {
    setCameraError(null);
    // Force the scanner effect to re-run by toggling the mode round-trip.
    setMode('wall');
    setTimeout(() => setMode('scanner'), 50);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-screen bg-gray-900 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden font-sans text-white">
      {/* ── Left: active mode ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center relative p-8">
        <Link to="/" className="absolute top-8 left-8 group">
          <h1 className="text-3xl font-extrabold tracking-tight text-white transition-transform group-active:scale-95">
            <span className="text-purple-500">Gym</span>phony
          </h1>
        </Link>

        {/* Mode switch */}
        <div className="absolute top-7 right-8 flex rounded-full bg-gray-800/80 p-1 ring-1 ring-white/10 backdrop-blur">
          <button
            type="button"
            onClick={() => setMode('wall')}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              mode === 'wall' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            <QrCode className="h-4 w-4" /> Wall QR
          </button>
          <button
            type="button"
            onClick={() => setMode('scanner')}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              mode === 'scanner' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            <ScanLine className="h-4 w-4" /> Scanner
          </button>
        </div>

        {/* ── WALL QR MODE ──────────────────────────────────────────────── */}
        {mode === 'wall' && (
          <div className="flex w-full max-w-xl flex-col items-center">
            <h2 className="mb-2 text-center text-4xl font-bold">
              {gymName ? `Check in at ${gymName}` : 'Scan to Check In'}
            </h2>
            <p className="mb-10 text-center text-lg text-gray-400">
              Open the <span className="font-semibold text-white">Gymphony</span> app → tap{' '}
              <span className="font-semibold text-white">Scan Gym QR</span> → point at this code.
            </p>

            {isResolvingGym ? (
              <div className="flex h-80 w-80 items-center justify-center rounded-3xl bg-gray-800">
                <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
              </div>
            ) : !isAuthed ? (
              <div className="flex max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/10 bg-gray-800 p-10 text-center">
                <Camera className="h-10 w-10 text-purple-400" />
                <p className="text-gray-300">
                  Sign in as the gym owner to display your check-in QR.
                </p>
                <Link
                  to="/login"
                  className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-500"
                >
                  Go to Login
                </Link>
              </div>
            ) : gymId ? (
              <>
                <div className="rounded-3xl bg-white p-6 shadow-2xl">
                  <QRCodeSVG value={wallPayload} size={320} level="M" includeMargin />
                </div>

                {!hasLocation ? (
                  <div className="mt-6 flex max-w-md items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
                    <MapPin className="mt-0.5 h-5 w-5 shrink-0" />
                    <span>
                      Set your gym's location in <strong>Settings → Gym Profile</strong> to enable
                      geo-fenced check-ins. Until then members can't verify they're on-site.
                    </span>
                  </div>
                ) : (
                  <p className="mt-6 flex items-center gap-2 text-sm text-gray-500">
                    <MapPin className="h-4 w-4" /> Geo-fenced — members must be on-site (within the radius set in Settings) to check in.
                  </p>
                )}
              </>
            ) : (
              <div className="flex max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/10 bg-gray-800 p-10 text-center">
                <MapPin className="h-10 w-10 text-amber-400" />
                <p className="text-gray-300">
                  No gym profile found for this account. Complete your gym setup in{' '}
                  <strong>Settings</strong> first.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── SCANNER MODE ──────────────────────────────────────────────── */}
        {mode === 'scanner' && (
          <>
            <h2 className="mb-2 text-center text-4xl font-bold">Scan your Entry Pass</h2>
            <p className="mb-12 text-center text-lg text-gray-400">
              Hold a member's QR pass up to the camera.
            </p>

            <div className="relative flex aspect-square w-full max-w-112.5 items-center justify-center overflow-hidden rounded-3xl border-4 border-gray-700 bg-gray-800 shadow-2xl">
              <div id="reader" className="h-full w-full scale-110 object-cover" />
              <div className="pointer-events-none absolute inset-0 m-4 rounded-3xl border-4 border-purple-500/30" />
              <div className="animate-[scan_4s_ease-in-out_infinite] pointer-events-none absolute left-0 top-0 h-1 w-full bg-purple-500 shadow-[0_0_15px_#a855f7]" />

              {cameraError && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-gray-900/95 p-8 text-center">
                  <Camera className="h-10 w-10 text-red-400" />
                  <p className="text-sm font-medium text-gray-200">{cameraError}</p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={retryScanner}
                      className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-500"
                    >
                      <RefreshCw className="h-4 w-4" /> Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('wall')}
                      className="flex items-center gap-2 rounded-xl bg-gray-700 px-4 py-2 text-sm font-bold text-gray-200 hover:bg-gray-600"
                    >
                      <QrCode className="h-4 w-4" /> Use Wall QR
                    </button>
                  </div>
                </div>
              )}

              {isProcessing && !successMember && !cameraError && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
                    <p className="text-xs font-bold uppercase tracking-widest text-white">Processing…</p>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {successMember && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 backdrop-blur-md ${
                      successMember.granted ? 'bg-green-600/30' : 'bg-red-600/30'
                    }`}
                  >
                    <div
                      className={`flex h-24 w-24 items-center justify-center rounded-full text-5xl ${
                        successMember.granted ? 'bg-green-500/30' : 'bg-red-500/30'
                      }`}
                    >
                      {successMember.granted ? '✅' : '❌'}
                    </div>
                    <h3 className="px-6 text-center text-3xl font-bold text-white">
                      {successMember.granted ? `Welcome, ${successMember.name}!` : 'Access Denied'}
                    </h3>
                    <p className="font-medium text-gray-200">
                      {successMember.granted ? 'Checked in successfully' : successMember.name}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      {/* ── Right: clock + live feed + exit ───────────────────────────────── */}
      <div className="flex w-full flex-col border-t border-gray-700 bg-gray-800 p-8 lg:w-96 lg:border-l lg:border-t-0">
        <div className="mb-12">
          <p className="mb-2 text-5xl font-light tracking-wider">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="font-medium text-gray-400">
            {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <h3 className="mb-6 text-sm font-bold uppercase tracking-widest text-gray-400">Recent Check-ins</h3>

          <div className="custom-scrollbar space-y-4 overflow-y-auto pr-2">
            <AnimatePresence initial={false}>
              {checkIns.length > 0 ? (
                checkIns.map((checkIn) => {
                  const isAccessDenied =
                    checkIn.status === 'denied' ||
                    checkIn.members?.status === 'Overdue' ||
                    checkIn.members?.status === 'Expired';
                  return (
                    <motion.div
                      key={checkIn.id}
                      initial={{ opacity: 0, x: 20, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -20, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      className={`flex items-center gap-4 rounded-2xl p-4 ${
                        isAccessDenied
                          ? 'border border-red-500/20 bg-red-500/10'
                          : 'border border-green-500/20 bg-green-500/10'
                      }`}
                    >
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${
                          isAccessDenied ? 'bg-red-500/20' : 'bg-green-500/20'
                        }`}
                      >
                        {isAccessDenied ? '❌' : '✅'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate font-bold ${isAccessDenied ? 'text-red-400' : 'text-green-400'}`}>
                          {isAccessDenied ? 'Access Denied' : 'Access Granted'}
                        </p>
                        <p className="truncate text-sm text-gray-300">
                          {checkIn.members?.full_name || 'Unknown Member'}
                        </p>
                        <p className="text-[10px] uppercase tracking-tighter text-gray-500">
                          {checkIn.members?.membership_plan || 'No Plan'} •{' '}
                          {new Date(checkIn.check_in_time).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </motion.div>
                  );
                })
              ) : (
                <p className="py-8 text-center text-gray-500">No recent check-ins</p>
              )}
            </AnimatePresence>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate({ to: '/dashboard', search: { tab: undefined, section: undefined } })}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-700 py-3 text-sm font-semibold text-gray-300 transition hover:bg-gray-600"
        >
          <LogOut className="h-4 w-4" /> Exit Kiosk Mode
        </button>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes scan {
          0% { transform: translateY(0); }
          50% { transform: translateY(430px); }
          100% { transform: translateY(0); }
        }
        #reader { border: none !important; }
        #reader video { border-radius: 1.5rem; object-fit: cover; }
        #reader__dashboard { display: none !important; }
        #reader__status_span { display: none !important; }
        #reader__scan_region { background: transparent !important; }
      `,
        }}
      />
    </div>
  );
}

export default KioskMode;
