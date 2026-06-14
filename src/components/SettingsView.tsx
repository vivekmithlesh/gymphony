import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { z } from "zod";
import {
  Settings,
  Building2,
  ShieldCheck,
  Bell,
  CreditCard,
  HelpCircle,
  Camera as CameraIcon,
  Save,
  ChevronRight,
  Lock,
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Loader2,
  Monitor,
  Crown,
  CheckCircle2,
  Sparkles,
  Zap,
  LocateFixed,
  MapPinned,
  MapPin,
  Search,
  Navigation2,
  Crosshair,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { startSubscriptionCheckout } from "@/lib/razorpay";
import {
  PLAN_LIST,
  PLANS,
  resolveSubscription,
  formatINR,
  TRIAL_DAYS,
  PRO_IS_WAITLIST,
  isComingSoonHighlight,
  type PlanTier,
  type BillingCycle,
} from "@/lib/plans";
import { subscriptionHasFeature } from "@/lib/permissions";
import { WallQRTab } from "@/components/WallQRTab";
import { GymJoinQRCode } from "@/components/GymJoinQRCode";
import { TimePicker } from "@/components/TimePicker";
// NOTE: do NOT statically import "@/lib/leafletDefaultIcon" here — it pulls in
// `leaflet`, which touches `window` at module load and crashes SSR for every
// route (SettingsView is in the dashboard's static import graph). The default
// icon fix is applied client-side inside LeafletMap's lazy import below.

// ─── Constants ───────────────────────────────────────────────────────────────

const MEDIA_BUCKET = "gym-photos";
// TODO: replace YOUR_SUPPORT_NUMBER with Gymphony's official support WhatsApp
// number (digits only, incl. country code, e.g. 919876543210).
const SUPPORT_WHATSAPP_NUMBER = "YOUR_SUPPORT_NUMBER";
const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Hi Gymphony Support, I need help with my gym dashboard",
)}`;
const ALIGARH_CENTER: [number, number] = [27.8974, 78.088];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;  // 5 MB  (hard limit, pre-compression)
const VIDEO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB (hard limit)

// Client-side image compression target — keeps quality for web/mobile while
// slashing storage + bandwidth cost at scale (10k+ users).
const IMAGE_COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5, // 500 KB
  maxWidthOrHeight: 1080,
  useWebWorker: true,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type LocationDraft = {
  latitude: number | null;
  longitude: number | null;
};

type GymSettings = {
  id?: string;
  gym_owner_id?: string;
  gym_name: string;
  owner_name: string;
  city: string;
  address: string;
  owner_email: string;
  contact_number: string;
  upi_id: string | null;
  logo_url: string | null;
  gym_photos: string[];
  gym_videos: string[];
  latitude: number | null;
  longitude: number | null;
  checkin_radius_m: number;
  allow_mock_payments: boolean;
  opening_time: string;
  closing_time: string;
  // Optional second ("evening") shift — gyms that close mid-afternoon. Same
  // "HH:MM" 24-hour string format as the primary (morning) shift. null when off.
  evening_opening_time: string | null;
  evening_closing_time: string | null;
  description: string;
  whatsapp_reminders: boolean;
  daily_summary_email: boolean;
  notify_new_member: boolean;
  notify_pending_payment: boolean;
  notify_low_stock: boolean;
  plan_type: string | null;
  plan_tier: string | null;
  plan_status: string | null;
  trial_ends_at: string | null;
  billing_cycle: string | null;
  subscription_start: string | null;
  expiry_date: string | null;
  terms_url: string | null;
  privacy_url: string | null;
  refund_url: string | null;
};

type Plan = {
  id: string;
  gym_id: string;
  name: string;
  plan_name?: string;
  price: number;
  duration: number;
  duration_days?: number;
  created_at?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toFiniteNumber = (value: unknown): number | null => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : null;
};

// Light URL check for the legal links: empty is allowed (optional); otherwise it
// must parse as a URL with a dotted hostname. A missing scheme is treated as https.
const isValidUrl = (value: string): boolean => {
  const s = value.trim();
  if (!s) return true;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
};

const buildDefaultSettings = (userId: string, email: string): Omit<GymSettings, "id"> => ({
  gym_owner_id: userId,
  gym_name: "Royal Fitness Gym",
  owner_name: "",
  city: "Mumbai",
  address: "123 Fitness Street, Near Central Park",
  owner_email: email,
  contact_number: "+91 7906240659",
  upi_id: null,
  logo_url: null,
  gym_photos: [],
  gym_videos: [],
  latitude: null,
  longitude: null,
  checkin_radius_m: 100,
  allow_mock_payments: false,
  opening_time: "",
  closing_time: "",
  evening_opening_time: null,
  evening_closing_time: null,
  description: "",
  whatsapp_reminders: true,
  daily_summary_email: false,
  notify_new_member: true,
  notify_pending_payment: true,
  notify_low_stock: true,
  plan_type: null,
  plan_tier: "trial",
  plan_status: "trial",
  trial_ends_at: null,
  billing_cycle: "monthly",
  subscription_start: null,
  expiry_date: null,
  terms_url: null,
  privacy_url: null,
  refund_url: null,
});

// Compress an image to <= 0.5 MB / 1080px using browser-image-compression
// (Web Worker, off the main thread). Dynamically imported so the library stays
// out of the initial bundle. Falls back to the original file on any failure.
async function compressImage(file: File): Promise<File> {
  try {
    const imageCompression = (await import("browser-image-compression")).default;
    // Returns a File sized to the options below (≤0.5 MB / 1080px).
    return await imageCompression(file, IMAGE_COMPRESSION_OPTIONS);
  } catch {
    return file; // never block an upload because compression failed
  }
}

// Zod validation for a single gallery file: type must be image/video and the
// raw size must be within the hard limits (images 5 MB, videos 15 MB).
const galleryFileSchema = z
  .object({
    name: z.string(),
    size: z.number(),
    type: z.string(),
  })
  .superRefine((f, ctx) => {
    const isImage = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/") || f.name.toLowerCase().endsWith(".mp4");
    if (!isImage && !isVideo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unsupported type" });
      return;
    }
    if (isImage && f.size > IMAGE_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exceeds 5 MB" });
    }
    if (isVideo && f.size > VIDEO_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exceeds 15 MB" });
    }
  });

// ─── SSR-safe Leaflet Map ─────────────────────────────────────────────────────

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  className?: string;
  children: (leaflet: Record<string, unknown>) => React.ReactNode;
}

function LeafletMap({ center, zoom, className, children }: LeafletMapProps) {
  const [leaflet, setLeaflet] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    Promise.all([
      import("leaflet"),
      import("react-leaflet"),
      import("@/lib/leafletDefaultIcon"),
    ]).then(([L, RL, icon]) => {
      const leafletInstance = L.default ?? L;
      setLeaflet({
        L: leafletInstance,
        // Explicit stock blue pin, built on the SAME instance the map draws with.
        markerIcon: icon.createDefaultMarkerIcon(leafletInstance),
        ...RL,
      });
    });
  }, []);

  if (!leaflet) {
    return (
      <div className="flex h-80 w-full items-center justify-center rounded-2xl border border-slate-100 bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-primary opacity-30" />
      </div>
    );
  }

  const { MapContainer, TileLayer } = leaflet as {
    MapContainer: React.ComponentType<Record<string, unknown>>;
    TileLayer: React.ComponentType<Record<string, unknown>>;
  };

  return (
    <MapContainer center={center} zoom={zoom} className={className} scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {children(leaflet)}
    </MapContainer>
  );
}

// ─── Operating-hours validation ───────────────────────────────────────────────

// "HH:MM" 24h → minutes since midnight (TimePicker's storage format).
const timeToMinutes = (v?: string | null): number | null => {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

// First (morning) shift is mandatory; the evening shift is optional, but if
// EITHER evening field is set, BOTH are required and must form a valid window.
const gymHoursSchema = z
  .object({
    opening_time: z.string().min(1, "Opening time is required"),
    closing_time: z.string().min(1, "Closing time is required"),
    evening_opening_time: z.string().nullable().optional(),
    evening_closing_time: z.string().nullable().optional(),
  })
  .superRefine((d, ctx) => {
    const hasEvening = !!(d.evening_opening_time || d.evening_closing_time);
    if (!hasEvening) return;
    if (!d.evening_opening_time || !d.evening_closing_time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evening_closing_time"],
        message: "Set both an evening opening and closing time.",
      });
      return;
    }
    const eo = timeToMinutes(d.evening_opening_time);
    const ec = timeToMinutes(d.evening_closing_time);
    if (eo != null && ec != null && ec <= eo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evening_closing_time"],
        message: "Evening closing time must be after evening opening time.",
      });
    }
  });

// ─── Main Component ───────────────────────────────────────────────────────────

export function SettingsView({ initialCategory = "Gym Profile" }: { initialCategory?: string }) {
  // ── Navigation ──────────────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  useEffect(() => { setActiveCategory(initialCategory); }, [initialCategory]);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const logoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const plansAbortRef = useRef<AbortController | null>(null);

  // ── Auth / IDs ──────────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null);
  const [gymId, setGymId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");

  // ── Settings state ──────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<GymSettings>(() =>
    buildDefaultSettings("", "") as GymSettings,
  );
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Tracks which legal link inputs currently hold an invalid URL (validated on blur).
  const [legalErrors, setLegalErrors] = useState<Record<string, boolean>>({});
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // ── Location state ──────────────────────────────────────────────────────────
  const [locationDraft, setLocationDraft] = useState<LocationDraft>({ latitude: null, longitude: null });
  const [locationQuery, setLocationQuery] = useState("");
  // Editable text mirrors of the coordinates. Kept as strings so an owner can
  // type intermediate values ("12.", "-") without the field reformatting mid-edit.
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);

  // ── Gallery state ───────────────────────────────────────────────────────────
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);

  // Billing cycle toggle for the SaaS plan cards (monthly | yearly).
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  // Whether the optional evening (second) shift is being shown. Seeded from the
  // loaded settings (effect below) so a saved evening shift reopens expanded.
  const [showEveningShift, setShowEveningShift] = useState(false);
  // Effective owner SaaS subscription, resolved from gym_settings (trial/expiry aware).
  const billingSub = resolveSubscription(settings);

  // ── Plans state ─────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isAddingPlan, setIsAddingPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planForm, setPlanForm] = useState({ name: "", price: "", duration: "" });
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  // ── Billing state ───────────────────────────────────────────────────────────
  const [isProcessingBilling, setIsProcessingBilling] = useState(false);
  const { user } = useAuth();

  // ── Init ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setCurrency(tz.startsWith("Asia/Calcutta") || tz.startsWith("Asia/Kolkata") ? "INR" : "USD");
  }, []);

  useEffect(() => {
    if (user) {
      setUserId(user.id);
      fetchSettings(user.id, user.email ?? "");
    } else {
      setIsLoadingSettings(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const lat = toFiniteNumber(settings.latitude);
    const lng = toFiniteNumber(settings.longitude);
    setLocationDraft({ latitude: lat, longitude: lng });
    setLatInput(lat !== null ? lat.toFixed(6) : "");
    setLngInput(lng !== null ? lng.toFixed(6) : "");
  }, [settings.latitude, settings.longitude]);

  useEffect(() => {
    if (activeCategory === "Billing & Plans") fetchPlans();
  }, [activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch settings ───────────────────────────────────────────────────────────
  const fetchSettings = useCallback(async (uid: string, email: string) => {
    setIsLoadingSettings(true);
    try {
      const { data, error } = await supabase
        .from("gym_settings")
        .select("*")
        .eq("gym_owner_id", uid)
        .single();

      if (error && error.code !== "PGRST116") throw error;

      if (data) {
        setGymId(data.id ?? null);
        setSettings({
          ...data,
          latitude: toFiniteNumber(data.latitude ?? data.lat),
          longitude: toFiniteNumber(data.longitude ?? data.lng),
          checkin_radius_m: toFiniteNumber(data.checkin_radius_m) ?? 100,
          allow_mock_payments: data.allow_mock_payments ?? false,
          gym_photos: Array.isArray(data.gym_photos) ? data.gym_photos : [],
          gym_videos: Array.isArray(data.gym_videos) ? data.gym_videos : [],
        });
      } else {
        const defaults = buildDefaultSettings(uid, email);
        const { data: created, error: insertError } = await supabase
          .from("gym_settings")
          .insert(defaults)
          .select()
          .single();
        if (!insertError && created) {
          setGymId(created.id ?? null);
          setSettings({ ...defaults, id: created.id } as GymSettings);
        }
      }
    } catch (err: unknown) {
      toast.error("Could not load settings: " + (err as Error).message);
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  // ── Persist settings ─────────────────────────────────────────────────────────
  const persistSettings = useCallback(
    async (partial: Partial<GymSettings>): Promise<boolean> => {
      if (!userId) return false;
      const merged = { ...settings, ...partial };
      setSettings(merged);

      setIsSaving(true);
      try {
        // Never upsert internal-only or undefined columns
        const { id, ...payload } = merged as GymSettings & { id?: string };
        const { error } = await supabase
          .from("gym_settings")
          .upsert(
            { ...payload, gym_owner_id: userId, updated_at: new Date().toISOString() },
            { onConflict: "gym_owner_id" },
          );
        if (error) throw error;

        window.dispatchEvent(new CustomEvent("gym-settings-updated", { detail: merged }));
        return true;
      } catch (err: unknown) {
        const msg = (err as Error).message ?? "";
        // Provide actionable schema-mismatch hints
        const schemaHints: Record<string, string> = {
          owner_name: "ALTER TABLE gym_settings ADD COLUMN owner_name TEXT;",
          plan_type: "ALTER TABLE gym_settings ADD COLUMN plan_type TEXT DEFAULT 'Free';",
          logo_url: "ALTER TABLE gym_settings ADD COLUMN logo_url TEXT;",
          latitude: "ALTER TABLE gym_settings ADD COLUMN latitude NUMERIC, longitude NUMERIC;",
          opening_time: "ALTER TABLE gym_settings ADD COLUMN opening_time TEXT, closing_time TEXT, description TEXT, address TEXT;",
          evening_opening_time: "ALTER TABLE gym_settings ADD COLUMN evening_opening_time TEXT, evening_closing_time TEXT;",
          gym_photos: "ALTER TABLE gym_settings ADD COLUMN gym_photos TEXT[], gym_videos TEXT[];",
        };
        const hint = Object.entries(schemaHints).find(([key]) => msg.includes(key));
        if (hint) {
          toast.error("Schema mismatch", { description: `Run: ${hint[1]}`, duration: 10_000 });
        } else {
          toast.error("Save failed", { description: msg || "Check connection or DB permissions." });
        }
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [userId, settings],
  );

  // ── Evening (second) shift ──────────────────────────────────────────────────
  // Reopen the evening-shift block if the gym already has one saved.
  useEffect(() => {
    if (settings.evening_opening_time || settings.evening_closing_time) {
      setShowEveningShift(true);
    }
  }, [settings.evening_opening_time, settings.evening_closing_time]);

  // Persist an evening time, then validate the full window with zod once both
  // ends are set (the schema requires both + open < close when the shift is on).
  const setEveningTime = useCallback(
    (field: "evening_opening_time" | "evening_closing_time", v: string) => {
      const candidate = { ...settings, [field]: v };
      void persistSettings({ [field]: v });
      const result = gymHoursSchema.safeParse(candidate);
      if (!result.success && candidate.evening_opening_time && candidate.evening_closing_time) {
        toast.error(result.error.issues[0]?.message ?? "Invalid evening hours");
      }
    },
    [settings, persistSettings],
  );

  const removeEveningShift = useCallback(() => {
    setShowEveningShift(false);
    void persistSettings({ evening_opening_time: null, evening_closing_time: null });
  }, [persistSettings]);

  // ── Logo upload ───────────────────────────────────────────────────────────────
  const handleLogoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const logoUrl = typeof reader.result === "string" ? reader.result : null;
        if (!logoUrl) { toast.error("Could not read logo file."); return; }
        const saved = await persistSettings({ logo_url: logoUrl });
        if (saved) toast.success(`${file.name} saved!`, { position: "bottom-center" });
      };
      reader.onerror = () => toast.error("Could not read logo file.");
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [persistSettings],
  );

  // ── Gallery upload ────────────────────────────────────────────────────────────
  const handleGalleryChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!files.length) return;
      if (!userId) { toast.error("Sign in to upload media."); return; }

      // Verify bucket access first
      const probe = await supabase.storage.from(MEDIA_BUCKET).list("", { limit: 1 });
      if (probe.error) {
        toast.error(`Storage bucket '${MEDIA_BUCKET}' is not accessible. Check Supabase project.`);
        return;
      }

      setIsUploadingGallery(true);
      const newPhotos: string[] = [];
      const newVideos: string[] = [];

      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/") || file.name.toLowerCase().endsWith(".mp4");

        // Validate type + hard size limits via the shared zod schema.
        const check = galleryFileSchema.safeParse({ name: file.name, size: file.size, type: file.type });
        if (!check.success) {
          toast.error(`${file.name}: ${check.error.issues[0]?.message ?? "invalid file"}, skipped.`);
          continue;
        }

        // Compress images on the client (≤0.5 MB / 1080px) BEFORE upload to cut
        // Supabase storage + bandwidth cost. Videos are uploaded as-is.
        let uploadFile: File = file;
        if (isImage) {
          uploadFile = await compressImage(file);
        }

        const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
        const filePath = `${userId}/${Date.now()}_${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(filePath, uploadFile, { upsert: true });

        if (uploadError) {
          const hint = uploadError.status === 403
            ? "Upload blocked (403): check bucket permissions."
            : uploadError.message.toLowerCase().includes("not found")
            ? `Bucket '${MEDIA_BUCKET}' not found in Supabase Storage.`
            : uploadError.message;
          toast.error(`${file.name}: ${hint}`);
          continue;
        }

        // Prefer public URL, fall back to signed URL (1 hour)
        const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(filePath);
        const url = pub?.publicUrl || await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(filePath, 3600)
          .then((r) => r.data?.signedUrl ?? null);

        if (!url) { toast.error(`${file.name}: uploaded but URL unavailable.`); continue; }
        if (isVideo) newVideos.push(url); else newPhotos.push(url);
      }

      if (!newPhotos.length && !newVideos.length) {
        toast.error("No media uploaded. Check bucket permissions.");
        setIsUploadingGallery(false);
        return;
      }

      // Fetch current DB values to avoid overwriting concurrent changes
      const { data: current } = await supabase
        .from("gym_settings")
        .select("gym_photos, gym_videos")
        .eq("gym_owner_id", userId)
        .single();

      const merged = {
        gym_photos: [...(Array.isArray(current?.gym_photos) ? current.gym_photos : []), ...newPhotos],
        gym_videos: [...(Array.isArray(current?.gym_videos) ? current.gym_videos : []), ...newVideos],
      };

      const saved = await persistSettings(merged);
      if (saved) {
        toast.success("Gallery updated!");
        await fetchSettings(userId, settings.owner_email);
      }
      setIsUploadingGallery(false);
    },
    [userId, settings.owner_email, persistSettings, fetchSettings],
  );

  const handleRemoveMedia = useCallback(
    async (url: string, type: "photo" | "video") => {
      const nextPhotos = type === "photo"
        ? (settings.gym_photos ?? []).filter((u) => u !== url)
        : settings.gym_photos ?? [];
      const nextVideos = type === "video"
        ? (settings.gym_videos ?? []).filter((u) => u !== url)
        : settings.gym_videos ?? [];

      const saved = await persistSettings({ gym_photos: nextPhotos, gym_videos: nextVideos });
      if (!saved) return;

      // Best-effort storage deletion
      try {
        const pathPart = url.split(`/${MEDIA_BUCKET}/`)[1];
        if (pathPart) {
          await supabase.storage.from(MEDIA_BUCKET).remove([decodeURIComponent(pathPart.split("?")[0])]);
        }
      } catch { /* non-fatal */ }
      toast.success("Media removed.");
    },
    [settings.gym_photos, settings.gym_videos, persistSettings],
  );

  // ── Location ──────────────────────────────────────────────────────────────────
  // Single funnel for every programmatic update (detect GPS, address search,
  // map click, pin drag). Keeps the draft, the search box, AND the editable
  // lat/lng text fields in sync so the pin and the inputs always agree.
  const pickLocation = useCallback((lat: number, lng: number) => {
    setLocationDraft({ latitude: lat, longitude: lng });
    setLocationQuery(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    setLatInput(lat.toFixed(6));
    setLngInput(lng.toFixed(6));
  }, []);

  // Manual typing into the lat/lng fields. We update the draft (which moves the
  // pin) only once the pair forms a valid coordinate, but never reformat the
  // string the owner is actively editing.
  const commitManualCoords = useCallback((latStr: string, lngStr: string) => {
    const lat = Number(latStr);
    const lng = Number(lngStr);
    const latOk = latStr.trim() !== "" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
    const lngOk = lngStr.trim() !== "" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
    if (latOk && lngOk) {
      setLocationDraft({ latitude: lat, longitude: lng });
      setLocationQuery(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    }
  }, []);

  const handleLatInput = useCallback((value: string) => {
    setLatInput(value);
    commitManualCoords(value, lngInput);
  }, [commitManualCoords, lngInput]);

  const handleLngInput = useCallback((value: string) => {
    setLngInput(value);
    commitManualCoords(latInput, value);
  }, [commitManualCoords, latInput]);

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) { toast.error("GPS not available in this browser."); return; }
    setIsDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        pickLocation(coords.latitude, coords.longitude);
        toast.success("Location detected!");
        setIsDetectingLocation(false);
      },
      (err) => { toast.error(err.message || "Could not detect location."); setIsDetectingLocation(false); },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [pickLocation]);

  const searchLocation = useCallback(async () => {
    const query = locationQuery.trim();
    if (!query) { toast.error("Enter a location to search."); return; }
    setIsSearchingLocation(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error("Search request failed.");
      const results = await res.json() as { lat: string; lon: string; display_name?: string }[];
      const first = results[0];
      if (!first) { toast.error("No location found."); return; }
      pickLocation(Number(first.lat), Number(first.lon));
      setLocationQuery(first.display_name ?? query);
      toast.success("Location found on map!");
    } catch (err: unknown) {
      toast.error((err as Error).message || "Location search failed.");
    } finally {
      setIsSearchingLocation(false);
    }
  }, [locationQuery, pickLocation]);

  const saveLocation = useCallback(async () => {
    if (!userId) { toast.error("Sign in first."); return; }
    if (locationDraft.latitude === null || locationDraft.longitude === null) {
      toast.error("Pick a location on the map first.");
      return;
    }
    // Clamp the radius to the DB-enforced bounds so a stray value can't 400 the
    // upsert or silently disable the geo-fence. Mirrors the CHECK on
    // gym_settings.checkin_radius_m (migration 20260616).
    const radius = Math.min(2000, Math.max(20, Math.round(toFiniteNumber(settings.checkin_radius_m) ?? 100)));
    setIsSavingLocation(true);
    const saved = await persistSettings({
      latitude: locationDraft.latitude,
      longitude: locationDraft.longitude,
      checkin_radius_m: radius,
    });
    if (saved) toast.success("Gym location saved!");
    setIsSavingLocation(false);
  }, [userId, locationDraft, settings.checkin_radius_m, persistSettings]);

  // ── Plans ─────────────────────────────────────────────────────────────────────
  const fetchPlans = useCallback(async () => {
    if (!user?.id) return;

    plansAbortRef.current?.abort();
    plansAbortRef.current = new AbortController();
    setIsLoadingPlans(true);

    try {
      let resolvedGymId = gymId;
      if (!resolvedGymId) {
        const { data: row } = await supabase
          .from("gym_settings")
          .select("id")
          .eq("gym_owner_id", user.id)
          .maybeSingle();
        resolvedGymId = row?.id ?? null;
        if (resolvedGymId) setGymId(resolvedGymId);
      }
      if (!resolvedGymId) { setPlans([]); return; }

      const { data, error } = await supabase
        .from("gym_plans")
        .select("*")
        .order("created_at", { ascending: true })
        .abortSignal(plansAbortRef.current.signal);

      if (error) { if (error.name === "AbortError") return; throw error; }

      setPlans(
        (data ?? [])
          .filter((p: Plan) => String(p.gym_id) === String(resolvedGymId))
          .map((p: Plan) => ({ ...p, name: p.name ?? p.plan_name, plan_name: p.name ?? p.plan_name })),
      );
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError")
        toast.error("Could not load plans: " + (err as Error).message);
    } finally {
      setIsLoadingPlans(false);
    }
  }, [gymId]);

  // Shared validation for the plan form.
  const validatePlanForm = () => {
    const { name, price, duration } = planForm;
    if (!name.trim() || price === "" || duration === "") {
      toast.error("Fill in the plan name, price and duration.");
      return null;
    }
    const priceNum = Number(price);
    const durationNum = Number(duration);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Enter a valid, non-negative price.");
      return null;
    }
    if (!Number.isInteger(durationNum) || durationNum < 1) {
      toast.error("Duration must be a whole number of months (1 or more).");
      return null;
    }
    return { name: name.trim(), priceNum, durationNum };
  };

  const handleAddPlan = useCallback(async () => {
    const valid = validatePlanForm();
    if (!valid) return;
    if (!gymId) { toast.error("Gym profile still loading — try again in a moment."); return; }

    setIsSavingPlan(true);
    try {
      const { error } = await supabase.from("gym_plans").insert([{
        name: valid.name,
        plan_name: valid.name,
        price: valid.priceNum,
        duration: valid.durationNum,
        duration_days: valid.durationNum * 30,
        gym_id: gymId,
      }]);
      if (error) throw error;
      toast.success("Plan added!");
      setPlanForm({ name: "", price: "", duration: "" });
      setIsAddingPlan(false);
      await fetchPlans();
    } catch (err: unknown) {
      toast.error("Add plan failed: " + (err as Error).message);
    } finally {
      setIsSavingPlan(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planForm, gymId, fetchPlans]);

  const handleUpdatePlan = useCallback(async () => {
    if (!editingPlan) return;
    const valid = validatePlanForm();
    if (!valid) return;

    setIsSavingPlan(true);
    try {
      const { error } = await supabase
        .from("gym_plans")
        .update({ name: valid.name, plan_name: valid.name, price: valid.priceNum, duration: valid.durationNum, duration_days: valid.durationNum * 30 })
        .eq("id", editingPlan.id)
        .eq("gym_id", gymId);
      if (error) throw error;
      setPlans((prev) => prev.map((p) => p.id === editingPlan.id
        ? { ...p, name: valid.name, plan_name: valid.name, price: valid.priceNum, duration: valid.durationNum }
        : p,
      ));
      setEditingPlan(null);
      setPlanForm({ name: "", price: "", duration: "" });
      toast.success("Plan updated!");
    } catch (err: unknown) {
      toast.error("Update plan failed: " + (err as Error).message);
    } finally {
      setIsSavingPlan(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPlan, planForm, gymId]);

  // Delete with an inline confirmation toast (no blocking native dialog).
  const handleDeletePlan = useCallback((id: string, name?: string) => {
    toast(`Delete "${name || "this plan"}"?`, {
      description: "New sign-ups won't see it. Existing members keep their current plan.",
      action: {
        label: "Delete",
        onClick: async () => {
          setDeletingPlanId(id);
          try {
            let query = supabase.from("gym_plans").delete().eq("id", id);
            if (gymId) query = query.eq("gym_id", gymId);
            const { error } = await query;
            if (error) throw error;
            setPlans((prev) => prev.filter((p) => p.id !== id));
            toast.success("Plan deleted.");
          } catch (err: unknown) {
            toast.error("Delete failed: " + (err as Error).message);
          } finally {
            setDeletingPlanId(null);
          }
        },
      },
      cancel: { label: "Cancel", onClick: () => {} },
    });
  }, [gymId]);

  const startEditing = useCallback((plan: Plan) => {
    setEditingPlan(plan);
    setPlanForm({ name: plan.name ?? "", price: String(plan.price), duration: String(plan.duration) });
    setIsAddingPlan(false);
  }, []);

  const cancelPlanForm = useCallback(() => {
    setEditingPlan(null);
    setIsAddingPlan(false);
    setPlanForm({ name: "", price: "", duration: "" });
  }, []);

  // ── Billing ───────────────────────────────────────────────────────────────────
  const handleStartTrial = useCallback(async () => {
    if (!userId) return;
    setIsProcessingBilling(true);
    try {
      // Plan columns are locked down (20260621) — the trial is started ONLY via
      // the SECURITY DEFINER RPC, which is one-time (no trial resets).
      const { error } = await supabase.rpc("app_start_owner_trial");
      if (error) throw error;
      // Re-read the authoritative row the server wrote.
      const { data } = await supabase.from("gym_settings").select("*").eq("gym_owner_id", userId).single();
      if (data) setSettings(data);
      toast.success(`${TRIAL_DAYS}-day free trial started — full Growth access unlocked!`);
    } catch (err: unknown) {
      toast.error("Trial error: " + (err as Error).message);
    } finally {
      setIsProcessingBilling(false);
    }
  }, [userId]);

  // Select / upgrade to a paid tier via Razorpay. The client NEVER writes the
  // plan (gym_settings plan columns are locked down — 20260621); the verified
  // razorpay-webhook grants it server-side. We just open checkout and refresh.
  const handleSelectPlan = useCallback(
    async (tier: PlanTier, cycle: BillingCycle) => {
      if (!userId) return;
      await startSubscriptionCheckout({
        tier,
        cycle,
        ownerId: userId,
        ownerEmail: settings.owner_email,
        ownerName: settings.gym_name,
        setProcessing: setIsProcessingBilling,
        onActivated: async () => {
          const { data } = await supabase.from("gym_settings").select("*").eq("gym_owner_id", userId).single();
          if (data) setSettings(data);
        },
      });
    },
    [userId, settings.owner_email, settings.gym_name],
  );

  // (Legacy mock/PhonePe/Stripe upgrade handlers removed — all paid upgrades now
  // go through handleSelectPlan → Razorpay → verified webhook → app_set_owner_plan.)

  // ── Security / Support ────────────────────────────────────────────────────────
  const handlePasswordReset = useCallback(async () => {
    if (!settings.owner_email) { toast.error("Owner email not set."); return; }
    if (isResettingPassword) return;
    setIsResettingPassword(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(settings.owner_email, {
        // window.location.origin works in dev + prod; ensure /reset-password is in
        // Supabase Auth → URL Configuration → Redirect URLs.
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Reset link sent to your registered email!");
    } catch (err: unknown) {
      toast.error((err as Error).message || "Could not send reset link. Please try again.");
    } finally {
      setIsResettingPassword(false);
    }
  }, [settings.owner_email, isResettingPassword]);

  // ── Derived ───────────────────────────────────────────────────────────────────
  const logoFallback = (settings.gym_name || "RF")
    .split(" ").filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "").join("") || "RF";

  const menuItems = [
    { name: "Gym Profile", icon: Building2 },
    { name: "Wall QR", icon: QrCode },
    { name: "Security", icon: ShieldCheck },
    { name: "Notifications", icon: Bell },
    { name: "Billing & Plans", icon: CreditCard },
    { name: "Help & Support", icon: HelpCircle },
  ];

  const locationBusy = isDetectingLocation || isSearchingLocation || isSavingLocation;
  const allMedia = [
    ...(settings.gym_photos ?? []).map((url) => ({ url, type: "photo" as const })),
    ...(settings.gym_videos ?? []).map((url) => ({ url, type: "video" as const })),
  ];

  // ── Loading state ─────────────────────────────────────────────────────────────
  if (isLoadingSettings) {
    return (
      <div className="flex min-h-[22rem] items-center justify-center rounded-3xl border border-border bg-white shadow-soft">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-slate-600">Loading gym settings…</p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold md:text-4xl">
          System <span className="text-gradient-brand">Settings</span>
        </h1>
        <p className="mt-1 text-muted-foreground">
          Manage your gym profile, security, and application preferences.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Sidebar */}
        <nav className="space-y-2">
          {menuItems.map(({ name, icon: Icon }) => (
            <button
              key={name}
              onClick={() => setActiveCategory(name)}
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 transition-all ${
                activeCategory === name
                  ? "border border-primary/20 bg-primary/10 font-bold text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-white hover:text-slate-700"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                <span className="text-sm">{name}</span>
              </span>
              <ChevronRight
                className={`h-4 w-4 transition-transform ${activeCategory === name ? "rotate-90" : "opacity-30"}`}
              />
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* ── GYM PROFILE ─────────────────────────────────────────────── */}
              {activeCategory === "Gym Profile" && (
                <>
                  {/* Hidden inputs */}
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*,.mp4,.mov,video/mp4,video/quicktime"
                    multiple
                    className="hidden"
                    onChange={handleGalleryChange}
                  />

                  {/* Gym Info */}
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold text-slate-900">Gym Information</CardTitle>
                      <CardDescription>Update your public profile details.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Logo */}
                      <div className="flex items-center gap-6">
                        <div className="group relative">
                          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl bg-gradient-brand text-3xl font-bold text-white shadow-glow">
                            {settings.logo_url
                              ? <img src={settings.logo_url} alt="gym logo" className="h-full w-full object-cover" />
                              : logoFallback}
                          </div>
                          <button
                            onClick={() => logoInputRef.current?.click()}
                            className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-3xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            <CameraIcon className="h-6 w-6 text-white" />
                          </button>
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900">{settings.gym_name}</h4>
                          <p className="text-sm text-muted-foreground">{settings.owner_email || "Owner email not set"}</p>
                          <Button variant="link" className="h-auto p-0 text-xs font-bold text-primary" onClick={() => logoInputRef.current?.click()}>
                            Change Logo
                          </Button>
                        </div>
                      </div>

                      {/* Fields */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(
                          [
                            { label: "Gym Name", key: "gym_name", placeholder: "Royal Fitness" },
                            { label: "Owner Name", key: "owner_name", placeholder: "e.g. Vivek Kumar" },
                            { label: "City", key: "city", placeholder: "Mumbai" },
                            { label: "Owner Email", key: "owner_email", placeholder: "owner@example.com" },
                            { label: "Contact Number", key: "contact_number", placeholder: "+91 …" },
                          ] as { label: string; key: keyof GymSettings; placeholder: string }[]
                        ).map(({ label, key, placeholder }) => (
                          <div key={key} className="space-y-2">
                            <Label className="text-slate-600">{label}</Label>
                            <Input
                              value={(settings[key] as string) ?? ""}
                              onChange={(e) => persistSettings({ [key]: e.target.value })}
                              placeholder={placeholder}
                              className="rounded-xl border-slate-200 bg-slate-50"
                            />
                          </div>
                        ))}

                        <div className="space-y-2 sm:col-span-2">
                          <Label className="text-slate-600">Address</Label>
                          <Input
                            value={settings.address}
                            onChange={(e) => persistSettings({ address: e.target.value })}
                            placeholder="123 Fitness Street"
                            className="rounded-xl border-slate-200 bg-slate-50"
                          />
                        </div>

                        {/* Gym UPI ID — members pay the owner directly (zero platform fee) */}
                        <div className="space-y-2 sm:col-span-2">
                          <Label className="text-slate-600">Gym UPI ID</Label>
                          <Input
                            value={settings.upi_id ?? ""}
                            onChange={(e) => persistSettings({ upi_id: e.target.value.trim() })}
                            placeholder="gymname@ybl"
                            inputMode="email"
                            autoCapitalize="none"
                            className="rounded-xl border-slate-200 bg-slate-50"
                          />
                          <p className="text-xs text-muted-foreground">
                            Members pay fees & store items straight to this UPI ID — Gymphony takes
                            <span className="font-semibold text-slate-600"> 0% fee</span>. Used to generate their payment QR.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-slate-600">{showEveningShift ? "Morning Opening Time" : "Opening Time"}</Label>
                          <TimePicker
                            value={settings.opening_time}
                            onChange={(v) => persistSettings({ opening_time: v })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-600">{showEveningShift ? "Morning Closing Time" : "Closing Time"}</Label>
                          <TimePicker
                            value={settings.closing_time}
                            onChange={(v) => persistSettings({ closing_time: v })}
                          />
                        </div>

                        {/* Optional evening (second) shift for gyms that close mid-afternoon. */}
                        <div className="space-y-3 sm:col-span-2">
                          {!showEveningShift ? (
                            <button
                              type="button"
                              onClick={() => setShowEveningShift(true)}
                              className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:border-primary/50 hover:bg-primary/5"
                            >
                              <Plus className="h-4 w-4" />
                              Add Evening Shift
                            </button>
                          ) : (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                              <div className="mb-3 flex items-center justify-between">
                                <Label className="text-slate-600">Evening Shift</Label>
                                <button
                                  type="button"
                                  onClick={removeEveningShift}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 transition-colors hover:text-red-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Remove
                                </button>
                              </div>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <Label className="text-slate-600">Evening Opening Time</Label>
                                  <TimePicker
                                    value={settings.evening_opening_time}
                                    onChange={(v) => setEveningTime("evening_opening_time", v)}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-slate-600">Evening Closing Time</Label>
                                  <TimePicker
                                    value={settings.evening_closing_time}
                                    onChange={(v) => setEveningTime("evening_closing_time", v)}
                                  />
                                </div>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                For gyms that close mid-afternoon (e.g. morning 5:00 AM–10:00 AM, evening 4:00 PM–10:00 PM).
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 sm:col-span-2">
                          <Label className="text-slate-600">Description</Label>
                          <textarea
                            value={settings.description}
                            onChange={(e) => persistSettings({ description: e.target.value })}
                            rows={4}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Legal & Compliance — required for payment-gateway approval */}
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        Legal &amp; Compliance Links
                      </CardTitle>
                      <CardDescription>
                        Required for payment-gateway approval. These links surface in the Member App &amp;
                        checkout footer so members can review your policies before paying.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {(
                        [
                          { label: "Terms & Conditions URL", key: "terms_url", placeholder: "https://yourgym.com/terms" },
                          { label: "Privacy Policy URL", key: "privacy_url", placeholder: "https://yourgym.com/privacy" },
                          { label: "Cancellation & Refund Policy URL", key: "refund_url", placeholder: "https://yourgym.com/refunds" },
                        ] as { label: string; key: keyof GymSettings; placeholder: string }[]
                      ).map(({ label, key, placeholder }) => (
                        <div key={key} className="space-y-2">
                          <Label className="text-slate-600">{label}</Label>
                          <Input
                            type="url"
                            inputMode="url"
                            autoCapitalize="none"
                            value={(settings[key] as string) ?? ""}
                            onChange={(e) => persistSettings({ [key]: e.target.value.trim() })}
                            onBlur={(e) =>
                              setLegalErrors((prev) => ({ ...prev, [key]: !isValidUrl(e.target.value) }))
                            }
                            placeholder={placeholder}
                            className={`rounded-xl bg-slate-50 ${
                              legalErrors[key]
                                ? "border-red-300 focus-visible:ring-red-300"
                                : "border-slate-200"
                            }`}
                          />
                          {legalErrors[key] && (
                            <p className="text-xs font-medium text-red-500">
                              Enter a valid URL, e.g. https://yourgym.com/terms
                            </p>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Gallery */}
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold text-slate-900">Gallery</CardTitle>
                      <CardDescription>Upload photos and videos for your public gym profile.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Button
                          onClick={() => galleryInputRef.current?.click()}
                          disabled={isUploadingGallery}
                          className="h-11 rounded-xl bg-slate-900 font-bold text-white"
                        >
                          {isUploadingGallery ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading…</> : "Add Media"}
                        </Button>
                        <p className="text-sm text-muted-foreground">Images up to 5 MB · Videos up to 15 MB</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {allMedia.length === 0 ? (
                          <div className="col-span-full rounded-2xl border border-dashed border-slate-100 px-4 py-8 text-center text-sm text-muted-foreground">
                            No media yet. Add images or short videos to make your profile shine.
                          </div>
                        ) : allMedia.map(({ url, type }) => {
                          const isVid = type === "video";
                          return (
                            <div key={url} className="relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
                              {isVid
                                ? <video src={url} className="h-32 w-full object-cover" controls preload="metadata" />
                                : <img src={url} alt="gym media" className="h-32 w-full object-cover" />}
                              <button
                                onClick={() => handleRemoveMedia(url, type)}
                                className="absolute right-2 top-2 rounded-full bg-white p-1 shadow-md"
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Location */}
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                          <CardTitle className="text-lg font-bold text-slate-900">Gym Location Setup</CardTitle>
                          <CardDescription>Detect GPS or pin location directly on the map.</CardDescription>
                        </div>
                        <Badge className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          <Crosshair className="mr-2 h-3 w-3" />
                          Live coordinates
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="flex flex-col gap-3 md:flex-row">
                        <Button
                          onClick={detectLocation}
                          disabled={locationBusy}
                          className="h-12 rounded-2xl bg-gradient-brand px-5 font-bold text-primary-foreground shadow-soft"
                        >
                          {isDetectingLocation
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            : <LocateFixed className="mr-2 h-4 w-4" />}
                          Detect My Location
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => toast.info("Click to drop the pin, then drag it to fine-tune.")}
                          className="h-12 rounded-2xl border-slate-200 px-5 font-bold"
                        >
                          <MapPinned className="mr-2 h-4 w-4" />
                          Choose on Map
                        </Button>
                      </div>

                      {/* Map with search overlay */}
                      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-sm">
                        <div className="absolute left-3 right-3 top-3 z-[500]">
                          <div className="flex gap-2 rounded-2xl border border-white/80 bg-white/95 p-2 shadow-soft backdrop-blur">
                            <div className="relative flex-1">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <Input
                                value={locationQuery}
                                onChange={(e) => setLocationQuery(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && searchLocation()}
                                placeholder="Search by street, area, or landmark"
                                className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 text-sm"
                              />
                            </div>
                            <Button
                              onClick={searchLocation}
                              disabled={isSearchingLocation}
                              className="h-11 rounded-xl bg-slate-900 px-4 font-bold text-white"
                            >
                              {isSearchingLocation
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Navigation2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>

                        <div className="h-80 w-full">
                          <LeafletMap
                            center={
                              locationDraft.latitude !== null && locationDraft.longitude !== null
                                ? [locationDraft.latitude, locationDraft.longitude]
                                : ALIGARH_CENTER
                            }
                            zoom={13}
                            className="h-full w-full"
                          >
                            {(lf) => {
                              const { Marker, Popup, useMap, useMapEvents } = lf as {
                                Marker: React.ComponentType<Record<string, unknown>>;
                                Popup: React.ComponentType<{ children: React.ReactNode }>;
                                useMap: () => { setView: (c: [number, number], z: number, o: Record<string, unknown>) => void };
                                useMapEvents: (handlers: Record<string, unknown>) => null;
                              };
                              const markerIcon = (lf as { markerIcon?: unknown }).markerIcon;

                              function MapController() {
                                const map = useMap();
                                useEffect(() => {
                                  if (locationDraft.latitude !== null && locationDraft.longitude !== null) {
                                    map.setView([locationDraft.latitude, locationDraft.longitude], 15, { animate: true });
                                  }
                                }, [map]);
                                return null;
                              }

                              function ClickHandler() {
                                useMapEvents({
                                  click(e: { latlng: { lat: number; lng: number } }) {
                                    pickLocation(e.latlng.lat, e.latlng.lng);
                                  },
                                });
                                return null;
                              }

                              return (
                                <>
                                  <MapController />
                                  <ClickHandler />
                                  {locationDraft.latitude !== null && locationDraft.longitude !== null && (
                                    <Marker
                                      position={[locationDraft.latitude, locationDraft.longitude]}
                                      icon={markerIcon}
                                      draggable
                                      eventHandlers={{
                                        dragend: (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
                                          const pos = e.target.getLatLng();
                                          pickLocation(pos.lat, pos.lng);
                                        },
                                      }}
                                    >
                                      <Popup>
                                        <div className="space-y-1">
                                          <p className="text-sm font-bold text-slate-900">Selected Location</p>
                                          <p className="text-xs text-slate-600">
                                            {locationDraft.latitude.toFixed(5)}, {locationDraft.longitude.toFixed(5)}
                                          </p>
                                        </div>
                                      </Popup>
                                    </Marker>
                                  )}
                                </>
                              );
                            }}
                          </LeafletMap>
                        </div>
                      </div>

                      {/* Coordinates — editable; typing moves the pin, dragging the pin fills these */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-slate-600">Latitude</Label>
                          <Input
                            inputMode="decimal"
                            value={latInput}
                            onChange={(e) => handleLatInput(e.target.value)}
                            placeholder="e.g. 27.897520"
                            className="rounded-xl border-slate-200 bg-white text-slate-900"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-600">Longitude</Label>
                          <Input
                            inputMode="decimal"
                            value={lngInput}
                            onChange={(e) => handleLngInput(e.target.value)}
                            placeholder="e.g. 78.088012"
                            className="rounded-xl border-slate-200 bg-white text-slate-900"
                          />
                        </div>
                      </div>

                      {/* Check-in radius — the geo-fence each member must be within (per gym) */}
                      <div className="space-y-2">
                        <Label className="text-slate-600">Check-in radius (metres)</Label>
                        <Input
                          inputMode="numeric"
                          type="number"
                          min={20}
                          max={2000}
                          value={settings.checkin_radius_m ?? 100}
                          onChange={(e) =>
                            setSettings((prev) => ({
                              ...prev,
                              checkin_radius_m: toFiniteNumber(e.target.value) ?? prev.checkin_radius_m,
                            }))
                          }
                          placeholder="100"
                          className="rounded-xl border-slate-200 bg-white text-slate-900"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          How close (20–2000&nbsp;m) a member must be to check in. Lower is stricter, but
                          phone GPS is often off by 20–50&nbsp;m indoors, so very low values cause failed check-ins.
                        </p>
                      </div>

                      {/* Why this matters — ties the location to Wall QR check-ins */}
                      {locationDraft.latitude === null || locationDraft.longitude === null ? (
                        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            <strong>Location not set.</strong> Members can't use Wall QR check-in until you
                            pin your gym here — it geo-fences check-ins to people physically on-site
                            (within {settings.checkin_radius_m ?? 100}&nbsp;m).
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                          <Crosshair className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            This location powers <strong>Wall QR check-in</strong>. Members scanning your printed QR
                            must be within <strong>{settings.checkin_radius_m ?? 100}&nbsp;m</strong> of this pin to check in.
                          </span>
                        </div>
                      )}

                      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-900">Need a quick adjustment?</p>
                          <p className="text-xs text-muted-foreground">Click the map, drag the pin, or type exact coordinates above.</p>
                        </div>
                        <Button
                          onClick={saveLocation}
                          disabled={isSavingLocation || locationDraft.latitude === null || locationDraft.longitude === null}
                          className="h-11 rounded-2xl bg-[#8B5CF6] px-5 font-bold text-white hover:bg-[#7C3AED]"
                        >
                          {isSavingLocation
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            : <Zap className="mr-2 h-4 w-4" />}
                          Save Gym Location
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Kiosk Mode */}
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold text-slate-900">Kiosk Mode</CardTitle>
                      <CardDescription>Dedicated check-in station for members.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
                        <Monitor className="h-10 w-10 text-primary" />
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-900">Launch Fullscreen Kiosk</p>
                          <p className="text-xs text-muted-foreground">Perfect for tablets or front-desk monitors.</p>
                        </div>
                        <Button
                          onClick={() => window.open("/kiosk", "_blank")}
                          className="h-12 w-full rounded-xl bg-slate-900 font-bold text-white shadow-lg"
                        >
                          Launch Kiosk Mode
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Preferences */}
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold text-slate-900">Preferences</CardTitle>
                      <CardDescription>Control your dashboard experience.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {subscriptionHasFeature(settings, "auto_reminders") ? (
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="font-medium text-slate-900">Automatic Reminders</Label>
                            <p className="text-xs text-muted-foreground">Send WhatsApp reminders when dues are overdue.</p>
                          </div>
                          <Switch
                            checked={settings.whatsapp_reminders}
                            onCheckedChange={(checked) => persistSettings({ whatsapp_reminders: checked })}
                            className="data-[state=checked]:bg-primary"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-between opacity-60">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Label className="font-medium text-slate-900">Automatic Reminders</Label>
                              <Badge className="h-4 border-none bg-amber-100 text-[8px] text-amber-700">PRO</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">WhatsApp reminders are a Pro feature.</p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setActiveCategory("Billing & Plans")} className="text-xs font-bold text-primary">
                            <Lock className="mr-1 h-3 w-3" /> Unlock
                          </Button>
                        </div>
                      )}
                      <div className="h-px bg-slate-100" />
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="font-medium text-slate-900">Daily Summary Email</Label>
                          <p className="text-xs text-muted-foreground">Receive attendance and payment report every morning.</p>
                        </div>
                        <Switch
                          checked={settings.daily_summary_email}
                          onCheckedChange={(checked) => persistSettings({ daily_summary_email: checked })}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

              {/* ── WALL QR ─────────────────────────────────────────────────── */}
              {activeCategory === "Wall QR" && (
                <div className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <WallQRTab
                      gymId={gymId}
                      gymName={settings.gym_name}
                      hasLocation={settings.latitude != null && settings.longitude != null}
                    />
                    <GymJoinQRCode gymId={gymId} gymName={settings.gym_name} />
                  </div>
                  <Card className="border-border bg-white shadow-soft">
                    <CardContent className="flex items-center justify-between gap-4 p-5">
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-slate-900">Online payments (demo gateway)</p>
                        <p className="text-xs text-muted-foreground">
                          Let members self-activate instantly via "Pay Online". Leave OFF until a real
                          gateway is connected — otherwise approve payments manually.
                        </p>
                      </div>
                      <Switch
                        checked={settings.allow_mock_payments}
                        onCheckedChange={(checked) => persistSettings({ allow_mock_payments: checked })}
                      />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* ── SECURITY ────────────────────────────────────────────────── */}
              {activeCategory === "Security" && (
                <Card className="border-border bg-white shadow-soft">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Lock className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg font-bold text-slate-900">Security Settings</CardTitle>
                    </div>
                    <CardDescription>Manage your password and authentication.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <p className="text-center text-sm text-slate-600">
                        A reset link will be sent to <strong>{settings.owner_email}</strong>.
                      </p>
                      <Button
                        onClick={handlePasswordReset}
                        disabled={isResettingPassword}
                        className="h-12 w-full rounded-xl bg-slate-900 font-bold text-white shadow-lg disabled:opacity-70"
                      >
                        {isResettingPassword ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
                        ) : (
                          "Send Reset Link"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── NOTIFICATIONS ───────────────────────────────────────────── */}
              {activeCategory === "Notifications" && (
                <Card className="border-border bg-white shadow-soft">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Bell className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg font-bold text-slate-900">Notification Preferences</CardTitle>
                    </div>
                    <CardDescription>Choose which alerts you receive on your dashboard.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(
                      [
                        { key: "notify_new_member", label: "Alert on New Member Signup", desc: "Get notified when a new member joins your gym." },
                        { key: "notify_pending_payment", label: "Alert on Pending UPI Payments", desc: "Know the moment a member submits a UPI payment to approve." },
                        { key: "notify_low_stock", label: "Low Stock / Inventory Alerts", desc: "Be warned when a store product is running low." },
                      ] as { key: keyof GymSettings; label: string; desc: string }[]
                    ).map(({ key, label, desc }, i) => (
                      <div key={key}>
                        {i > 0 && <div className="mb-4 h-px bg-slate-100" />}
                        <div className="flex items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <Label className="font-medium text-slate-900">{label}</Label>
                            <p className="text-xs text-muted-foreground">{desc}</p>
                          </div>
                          <Switch
                            checked={Boolean(settings[key])}
                            onCheckedChange={(checked) => persistSettings({ [key]: checked })}
                            className="data-[state=checked]:bg-primary"
                          />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* ── HELP & SUPPORT ──────────────────────────────────────────── */}
              {activeCategory === "Help & Support" && (
                <Card className="border-border bg-white shadow-soft">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg font-bold text-slate-900">Contact Support</CardTitle>
                    </div>
                    <CardDescription>Our team is available 24/7.</CardDescription>
                  </CardHeader>
                  <CardContent className="py-10 text-center">
                    <p className="mb-6 text-muted-foreground">Have questions about Gymphony?</p>
                    <div className="mx-auto flex max-w-xs flex-col gap-3">
                      {subscriptionHasFeature(settings, "whatsapp_support") ? (
                        <Button
                          onClick={() => window.open(SUPPORT_WHATSAPP_URL, "_blank", "noopener,noreferrer")}
                          className="rounded-xl bg-primary px-8 font-bold text-white shadow-lg shadow-primary/20"
                        >
                          Chat on WhatsApp
                        </Button>
                      ) : (
                        <Button
                          onClick={() => setActiveCategory("Billing & Plans")}
                          className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 font-bold text-white shadow-lg shadow-amber-200"
                        >
                          <Crown className="h-4 w-4" />
                          Unlock WhatsApp Support
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => { window.location.href = `mailto:support@gymphony.com?subject=${encodeURIComponent("Support Request - Gymphony")}`; }}
                        className="rounded-xl border-slate-200 font-bold text-slate-900"
                      >
                        Email Support
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── BILLING & PLANS ─────────────────────────────────────────── */}
              {activeCategory === "Billing & Plans" && (
                <div className="space-y-8">
                  {/* Subscription status */}
                  <div className="flex flex-col gap-4 rounded-[2rem] border border-slate-100 bg-white p-6 shadow-soft md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${billingSub.tier === "pro" ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-500"}`}>
                        {billingSub.tier === "pro" ? <Crown className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-black text-slate-900">Current Plan: {billingSub.plan.name}</h3>
                          <Badge className={`rounded-full border-none px-3 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                            billingSub.isTrial ? "bg-amber-100 text-amber-700" : billingSub.status === "active" ? "bg-primary text-white shadow-glow" : "bg-slate-100 text-slate-500"
                          }`}>
                            {billingSub.isTrial ? `Trial · ${billingSub.trialDaysLeft}d left` : billingSub.status === "active" ? "Active" : billingSub.status === "expired" ? "Expired" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-sm font-medium text-muted-foreground">
                          {billingSub.isTrial
                            ? <>Your free trial ends {billingSub.trialEndsAt ? <span className="font-bold text-slate-900">{billingSub.trialEndsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span> : "soon"}. Pick a plan to keep your features.</>
                            : billingSub.status === "active" && settings.expiry_date
                              ? <>Renews <span className="font-bold text-slate-900">{new Date(settings.expiry_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span> · {Number.isFinite(billingSub.memberLimit) ? `${billingSub.memberLimit.toLocaleString("en-IN")} members` : "Unlimited members"}</>
                              : "Start your free trial or choose a plan to unlock Gymphony."}
                        </p>
                      </div>
                    </div>
                    {billingSub.status !== "active" && !billingSub.isTrial && (
                      <Button
                        onClick={handleStartTrial}
                        disabled={isProcessingBilling}
                        className="h-12 rounded-xl bg-primary px-6 font-black text-white shadow-glow"
                      >
                        {isProcessingBilling ? <Loader2 className="h-5 w-5 animate-spin" /> : `Start ${TRIAL_DAYS}-Day Free Trial`}
                      </Button>
                    )}
                  </div>

                  {/* Billing cycle toggle */}
                  <div className="flex items-center justify-center gap-3">
                    <button onClick={() => setBillingCycle("monthly")} className={`rounded-full px-5 py-2 text-sm font-bold transition-all ${billingCycle === "monthly" ? "bg-primary text-white shadow-glow" : "bg-slate-100 text-slate-500"}`}>Monthly</button>
                    <button onClick={() => setBillingCycle("yearly")} className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition-all ${billingCycle === "yearly" ? "bg-primary text-white shadow-glow" : "bg-slate-100 text-slate-500"}`}>
                      Yearly <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">2 months free</span>
                    </button>
                  </div>

                  {/* Plan cards — driven entirely by the central plan config */}
                  <div className="grid gap-6 md:grid-cols-3">
                    {PLAN_LIST.map((p) => {
                      const isCurrent = billingSub.tier === p.id && billingSub.status === "active";
                      const priceNum = billingCycle === "yearly" ? p.priceYearlyPerMonth : p.priceMonthly;
                      // Pro features aren't built yet — never let anyone pay for them.
                      const isWaitlist = p.id === "pro" && PRO_IS_WAITLIST;
                      return (
                        <Card key={p.id} className={`relative flex flex-col overflow-hidden shadow-soft ${p.popular ? "border-none bg-linear-to-b from-[#2a2545] to-[#1e1b34] text-white shadow-glow" : "border-border bg-white"} ${isCurrent ? "ring-2 ring-primary" : ""}`}>
                          {p.popular && (
                            <div className="absolute right-4 top-4">
                              <Badge className="flex items-center gap-1 border-none bg-primary px-3 py-1 text-[10px] font-bold text-white"><Sparkles className="h-3 w-3" />Most popular</Badge>
                            </div>
                          )}
                          <CardHeader className="pb-4">
                            <CardTitle className={`text-xl font-bold ${p.popular ? "text-white" : "text-slate-900"}`}>{p.name}</CardTitle>
                            <div className="mt-2 flex items-baseline gap-1">
                              <span className={`text-4xl font-black ${p.popular ? "text-white" : "text-slate-900"}`}>{formatINR(priceNum)}</span>
                              <span className={`text-sm font-medium ${p.popular ? "text-slate-400" : "text-muted-foreground"}`}>/ mo</span>
                            </div>
                            {billingCycle === "yearly" && (
                              <p className={`mt-1 text-xs font-semibold ${p.popular ? "text-slate-400" : "text-muted-foreground"}`}>{formatINR(p.priceYearlyTotal)} billed yearly</p>
                            )}
                            <CardDescription className={`pt-2 leading-relaxed ${p.popular ? "text-slate-400" : "text-slate-500"}`}>{p.tagline}</CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <Button
                              variant={p.popular ? "default" : "outline"}
                              onClick={() =>
                                isWaitlist
                                  ? toast.success("You're on the Pro waitlist — we'll email you the moment it launches.")
                                  : handleSelectPlan(p.id, billingCycle)
                              }
                              disabled={isProcessingBilling || isCurrent}
                              className={`h-12 w-full rounded-full font-black ${p.popular ? "bg-primary text-white" : "border-slate-200 text-slate-900"}`}
                            >
                              {isProcessingBilling
                                ? <Loader2 className="h-5 w-5 animate-spin" />
                                : isCurrent
                                  ? "Current Plan"
                                  : isWaitlist
                                    ? "Join waitlist"
                                    : billingSub.isTrial
                                      ? `Choose ${p.name}`
                                      : `Upgrade to ${p.name}`}
                            </Button>
                          </CardContent>
                          <CardContent className="grow">
                            <div className="space-y-3 pt-4">
                              {p.highlights.map((f) => {
                                const comingSoon = isComingSoonHighlight(f);
                                return (
                                  <div key={f} className={`flex items-center gap-2 text-sm font-medium ${comingSoon ? "opacity-60" : ""} ${p.popular ? "text-slate-300" : "text-slate-600"}`}>
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full ${p.popular ? "bg-white/10" : "bg-primary/5"}`}>
                                      <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" />
                                    </div>
                                    <span>{f}</span>
                                    {comingSoon && (
                                      <Badge variant="outline" className={`ml-auto shrink-0 border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${p.popular ? "border-white/20 text-slate-300" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
                                        Coming soon
                                      </Badge>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {/* Gym Plans CRUD */}
                  <Card className="border-border bg-white shadow-soft">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-lg font-bold text-slate-900">Gym Plans</CardTitle>
                        <CardDescription>Manage membership plans and pricing.</CardDescription>
                      </div>
                      <Button
                        onClick={isAddingPlan || editingPlan ? cancelPlanForm : () => setIsAddingPlan(true)}
                        className="h-9 rounded-xl bg-primary font-bold text-white"
                      >
                        {isAddingPlan || editingPlan ? "Cancel" : <><Plus className="mr-2 h-4 w-4" />Add Plan</>}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <AnimatePresence>
                        {(isAddingPlan || editingPlan) && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 p-6"
                          >
                            <div className="grid gap-4 sm:grid-cols-3">
                              <div className="space-y-2">
                                <Label className="text-slate-600">Plan Name</Label>
                                <Input
                                  placeholder="e.g. Pro Monthly"
                                  value={planForm.name}
                                  onChange={(e) => setPlanForm((p) => ({ ...p, name: e.target.value }))}
                                  className="rounded-xl border-slate-200 bg-white"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-slate-600">Price (₹)</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  placeholder="2000"
                                  value={planForm.price}
                                  onChange={(e) => setPlanForm((p) => ({ ...p, price: e.target.value }))}
                                  className="rounded-xl border-slate-200 bg-white"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-slate-600">Duration (Months)</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  placeholder="1"
                                  value={planForm.duration}
                                  onChange={(e) => setPlanForm((p) => ({ ...p, duration: e.target.value }))}
                                  className="rounded-xl border-slate-200 bg-white"
                                />
                              </div>
                            </div>
                            <div className="mt-4 flex justify-end">
                              <Button
                                onClick={editingPlan ? handleUpdatePlan : handleAddPlan}
                                disabled={isSavingPlan}
                                className="rounded-xl bg-gradient-brand px-6 font-bold text-primary-foreground"
                              >
                                {isSavingPlan ? (
                                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{editingPlan ? "Updating…" : "Adding…"}</>
                                ) : (
                                  editingPlan ? "Update Plan" : "Add Plan"
                                )}
                              </Button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {isLoadingPlans ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-10">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="text-sm text-muted-foreground">Loading plans…</p>
                        </div>
                      ) : plans.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-10 text-center">
                          <CreditCard className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                          <h4 className="font-bold text-slate-900">No Plans Yet</h4>
                          <p className="text-sm text-muted-foreground">Create your first membership plan.</p>
                        </div>
                      ) : (
                        <div className="grid gap-4">
                          {plans.map((plan) => (
                            <div
                              key={plan.id}
                              className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:border-primary/20"
                            >
                              <div className="flex items-center gap-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                  <CreditCard className="h-5 w-5" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-slate-900">{plan.name}</h4>
                                  <p className="text-xs text-muted-foreground">
                                    ₹{plan.price.toLocaleString()} · {plan.duration} {plan.duration === 1 ? "Month" : "Months"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={() => startEditing(plan)} className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-primary/5 hover:text-primary">
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeletePlan(plan.id, plan.name)}
                                  disabled={deletingPlanId === plan.id}
                                  className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-red-50 hover:text-red-500"
                                >
                                  {deletingPlanId === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* ── Save bar ─────────────────────────────────────────────────── */}
              <div className="flex justify-end gap-3 pt-4">
                <Button
                  variant="ghost"
                  className="rounded-xl text-muted-foreground hover:bg-slate-50"
                  onClick={() => userId && fetchSettings(userId, settings.owner_email)}
                >
                  Discard
                </Button>
                <Button
                  onClick={() => persistSettings(settings).then((ok) => ok && toast.success("Settings saved!"))}
                  disabled={isSaving}
                  className="rounded-xl bg-gradient-brand px-8 font-bold text-primary-foreground shadow-glow hover:shadow-primary/40"
                >
                  {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><Save className="mr-2 h-4 w-4" />Save Changes</>}
                </Button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
