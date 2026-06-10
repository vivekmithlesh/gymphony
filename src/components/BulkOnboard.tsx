import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  X,
  Trash2,
  Plus,
  Loader2,
  FileSpreadsheet,
  Send,
  AlertTriangle,
  MessageCircle,
  CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { isValidInternationalPhone, normalizeToE164Phone, phoneForWaMe } from "@/lib/phone";

interface ParsedRow {
  id: string;
  name: string;
  phone: string;
  plan: string;
}

interface InviteRecord {
  id: string;
  name: string;
  phone: string;
  link: string;
  message: string;
  sent: boolean;
}

// Optional: set VITE_INVITE_WEBHOOK_URL to an n8n/automation endpoint to send
// invites fully automatically. If unset, owners send via WhatsApp deep links.
const INVITE_WEBHOOK = (import.meta as any).env?.VITE_INVITE_WEBHOOK_URL as string | undefined;

interface BulkOnboardProps {
  open: boolean;
  onClose: () => void;
  gymId: string | null;
  gymOwnerId: string | null;
  gymName: string;
  plans: { id?: string; name?: string | null }[];
  onComplete: () => void; // refresh the members list
}

const PLAN_FALLBACK = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];

const rid = () => Math.random().toString(36).slice(2);

interface RawRow {
  name: string;
  phone: string;
  plan: string;
}

const HEADER_ALIASES = {
  name: ["name", "full name", "fullname", "member", "member name", "membername"],
  phone: ["phone", "mobile", "number", "phone number", "mobile number", "contact", "whatsapp"],
  plan: ["plan", "membership", "package", "membership plan", "membershipplan"],
};

const findIdx = (header: string[], aliases: string[], fallback: number) => {
  const i = header.findIndex((h) => aliases.includes(h));
  return i >= 0 ? i : fallback;
};

// Turn an array-of-arrays (CSV lines / XLSX rows) into Name/Phone/Plan records.
// Auto-detects a header row and arbitrary column order. NEVER invents data —
// only what's actually in the document is returned.
const rowsToRecords = (rows: string[][]): RawRow[] => {
  const cleaned = rows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (cleaned.length === 0) return [];

  const header = cleaned[0].map((c) => String(c ?? "").toLowerCase().trim());
  const hasHeader =
    header.some((c) => HEADER_ALIASES.name.includes(c)) ||
    header.some((c) => HEADER_ALIASES.phone.includes(c));

  const nameIdx = hasHeader ? findIdx(header, HEADER_ALIASES.name, 0) : 0;
  const phoneIdx = hasHeader ? findIdx(header, HEADER_ALIASES.phone, 1) : 1;
  const planIdx = hasHeader ? findIdx(header, HEADER_ALIASES.plan, 2) : 2;
  const data = hasHeader ? cleaned.slice(1) : cleaned;

  return data
    .map((cols) => ({
      name: String(cols[nameIdx] ?? "").trim(),
      phone: String(cols[phoneIdx] ?? "").trim(),
      plan: String(cols[planIdx] ?? "").trim(),
    }))
    .filter((r) => r.name !== "" || r.phone !== "");
};

const splitCsvLine = (line: string, delim: string): string[] =>
  line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim());

// Real CSV parsing (no library needed).
const parseCsv = (text: string): RawRow[] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  return rowsToRecords(lines.map((l) => splitCsvLine(l, delim)));
};

// Real Excel parsing via SheetJS (reads the first sheet).
const parseXlsx = async (file: File): Promise<RawRow[]> => {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "" });
  return rowsToRecords(aoa.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [])));
};

export function BulkOnboard({ open, onClose, gymId, gymOwnerId, gymName, plans, onComplete }: BulkOnboardProps) {
  const [stage, setStage] = useState<"upload" | "review" | "sent">("upload");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Real plan options for the dropdown (the gym's own plans). Falls back to a
  // sensible default list only if the gym truly has no plans defined yet.
  const derivedPlans = Array.from(
    new Set((plans || []).map((p) => (p.name || p.id || "").trim()).filter(Boolean))
  ) as string[];
  const planOptions = derivedPlans.length ? derivedPlans : PLAN_FALLBACK;

  // Match a plan string from the document to one of the gym's real plans
  // (case-insensitive). Returns "" if it doesn't match — never guesses a value.
  const canonicalPlan = (p: string) => {
    const t = (p || "").trim().toLowerCase();
    if (!t) return "";
    return planOptions.find((o) => o.toLowerCase() === t) || "";
  };

  const toParsed = (raw: RawRow): ParsedRow => ({
    id: rid(),
    name: raw.name,
    phone: raw.phone,
    plan: canonicalPlan(raw.plan),
  });

  const reset = () => {
    setStage("upload");
    setRows([]);
    setInvites([]);
    setIsParsing(false);
    setIsSaving(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  // STEP 1 — Upload & extract REAL data only (CSV or Excel). No fabricated rows.
  const handleFile = async (file: File) => {
    setIsParsing(true);
    try {
      const name = file.name.toLowerCase();
      let records: RawRow[] = [];

      if (name.endsWith(".csv") || file.type === "text/csv") {
        records = parseCsv(await file.text());
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        records = await parseXlsx(file);
      } else if (file.type.startsWith("image/")) {
        toast.error("Image scanning isn't available yet. Please upload a CSV or Excel file, or add members manually.");
        return; // never fabricate data
      } else {
        toast.error("Unsupported file. Please upload a CSV or Excel (.xlsx) file.");
        return;
      }

      const parsed = records.map(toParsed);

      if (parsed.length === 0) {
        toast.error("No member data found. Make sure the file has Name and Phone columns.");
        // Open an empty grid for manual entry — we do not invent rows.
        setRows([]);
        setStage("review");
        return;
      }

      setRows(parsed);
      setStage("review");
      const missingPlans = parsed.filter((r) => !r.plan).length;
      toast.success(
        `Loaded ${parsed.length} member(s)` +
          (missingPlans > 0 ? ` — pick a plan for ${missingPlans} row(s).` : ".")
      );
    } catch (err) {
      console.warn("Bulk parse failed:", err);
      toast.error("Could not read that file. Please try a CSV or Excel (.xlsx) file.");
    } finally {
      setIsParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Editable-grid helpers.
  const updateRow = (id: string, patch: Partial<ParsedRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  const addRow = () =>
    setRows((prev) => [...prev, { id: rid(), name: "", phone: "", plan: "" }]);

  const isRowValid = (r: ParsedRow) => {
    const normalized = normalizeToE164Phone(r.phone, "+91");
    return (
      r.name.trim().length > 0 &&
      !!normalized &&
      isValidInternationalPhone(normalized) &&
      r.plan.trim().length > 0 // owner must pick a real plan — no silent default
    );
  };
  const validRows = rows.filter(isRowValid);
  const invalidCount = rows.length - validRows.length;

  // =========================================================================
  // STEP 3 — LOCKED-IDENTITY SIGNUP (notes for the Auth routing logic)
  // -------------------------------------------------------------------------
  // The invite link below carries THREE things the signup route must honour:
  //   • gym_id  — which gym this person is joining
  //   • phone   — the EXACT E.164 number the owner registered
  //   • token   — the pending member's row id (acts as a one-time claim token)
  //
  // Auth routing rules to implement on /signup:
  //   1. Read `phone` + `token` from the URL and look up the matching
  //      members row (status = 'pending_signup', id = token, mobile_number = phone).
  //   2. PRE-FILL the phone field from the URL and render it DISABLED /
  //      read-only — the member must NOT be able to change it. Their account
  //      identity is permanently tied to the number the owner registered.
  //   3. On successful signup, set members.auth_user_id = the new auth uid and
  //      flip status 'pending_signup' -> 'Active'. Reject the flow if the phone
  //      in the URL doesn't match the token's row (prevents number swapping).
  //   4. Once active, their Virtual ID (QR = member id) is already what the
  //      Kiosk scans, so attendance linking is automatic — no extra step.
  // For production, sign `token` (e.g. a short-lived JWT) instead of using the
  // raw row id, so links can't be guessed or replayed.
  // =========================================================================
  const buildInviteLink = (memberId: string, phoneE164: string) => {
    const params = new URLSearchParams({
      gym_id: gymId ?? "",
      phone: phoneE164,   // signup MUST pre-fill + lock this field
      token: memberId,    // TODO(auth): replace raw id with a signed token
    });
    return `${window.location.origin}/signup?${params.toString()}`;
  };

  const buildInvite = (member: {
    id: string;
    full_name?: string | null;
    mobile_number?: string | null;
  }): InviteRecord => {
    const phoneE164 = member.mobile_number || "";
    const link = buildInviteLink(member.id, phoneE164);
    const message =
      `You are now a member of ${gymName || "our gym"}. ` +
      `Click here to join Gymphony to track your attendance and fees: ${link}`;
    return { id: member.id, name: member.full_name || "Member", phone: phoneE164, link, message, sent: false };
  };

  // Automated send via a configured webhook (n8n / SMS/WhatsApp provider).
  const sendViaWebhook = async (inv: InviteRecord): Promise<boolean> => {
    if (!INVITE_WEBHOOK) return false;
    try {
      const res = await fetch(INVITE_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: inv.name, phone: inv.phone, message: inv.message, link: inv.link, gym: gymName }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Manual send: open WhatsApp pre-filled so the owner sends from their own number.
  const openWhatsApp = (inv: InviteRecord) => {
    window.open(
      `https://wa.me/${phoneForWaMe(inv.phone)}?text=${encodeURIComponent(inv.message)}`,
      "_blank",
      "noopener"
    );
    setInvites((prev) => prev.map((x) => (x.id === inv.id ? { ...x, sent: true } : x)));
  };

  // Open each invite in sequence (small gap so the browser allows the tabs).
  const sendAll = () => {
    invites.forEach((inv, i) => setTimeout(() => openWhatsApp(inv), i * 400));
  };

  // STEP 2 — Bulk insert (status 'pending_signup') + fire invites.
  const handleSaveAndInvite = async () => {
    if (!gymId) {
      toast.error("Complete your gym profile before onboarding members.");
      return;
    }
    if (validRows.length === 0) {
      toast.error("No valid rows. Each member needs a name and a valid phone number.");
      return;
    }

    setIsSaving(true);
    try {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1); // placeholder until they pick/pay a plan

      const payload = validRows.map((r) => {
        const phoneE164 = normalizeToE164Phone(r.phone, "+91")!;
        return {
          full_name: r.name.trim(),
          mobile_number: phoneE164,
          phone: phoneE164,
          membership_plan: r.plan,
          status: "pending_signup",
          expiry_date: expiry.toISOString(),
          gym_id: gymId,
          gym_owner_id: gymOwnerId,
        };
      });

      const { data, error } = await supabase
        .from("members")
        .insert(payload)
        .select("id, full_name, mobile_number");

      if (error) throw error;

      const built = (data || []).map(buildInvite);

      // Automated delivery: prefer a configured webhook, else the send-invite
      // edge function (WhatsApp Cloud API / Twilio). If neither delivers, the
      // owner sends each via WhatsApp from the next step.
      let autoSent = 0;
      if (INVITE_WEBHOOK) {
        await Promise.all(
          built.map(async (inv, i) => {
            const ok = await sendViaWebhook(inv);
            if (ok) {
              built[i].sent = true;
              autoSent += 1;
            }
          })
        );
      } else {
        try {
          const { data: sendData, error: sendErr } = await supabase.functions.invoke("send-invite", {
            body: {
              gymName,
              invites: built.map((b) => ({ name: b.name, phone: b.phone, message: b.message, link: b.link })),
            },
          });
          if (!sendErr && sendData?.results) {
            const sentPhones = new Set(
              (sendData.results as { phone: string; sent: boolean }[])
                .filter((r) => r.sent)
                .map((r) => r.phone)
            );
            built.forEach((b, i) => {
              if (sentPhones.has(b.phone)) {
                built[i].sent = true;
                autoSent += 1;
              }
            });
          }
        } catch (e) {
          // Function not deployed / no provider keys — fall back to manual WhatsApp.
          console.warn("send-invite unavailable, using manual WhatsApp:", e);
        }
      }

      if (gymOwnerId) {
        await supabase.from("activity_log").insert([
          {
            gym_owner_id: gymOwnerId,
            activity_type: "bulk_onboard",
            description: `Bulk-onboarded ${built.length} member(s) and prepared invites.`,
            is_read: false,
          },
        ]);
      }

      setInvites(built);
      setStage("sent");
      onComplete(); // refresh the members list now

      toast.success(
        autoSent > 0
          ? `${built.length} added — ${autoSent} invite(s) sent automatically.`
          : `${built.length} member(s) added. Send their invites below.`
      );
    } catch (err: any) {
      console.warn("Bulk onboard failed:", err);
      toast.error(`Could not save members: ${err?.message || "unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-white rounded-[2rem] shadow-2xl p-8 max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Bulk Onboard Members</h3>
              <p className="text-sm text-slate-500">
                {stage === "upload"
                  ? "Upload a CSV/Excel or a photo of your member register."
                  : stage === "review"
                    ? "Review, fix typos, and remove invalid rows before saving."
                    : "Members added — send their invites on WhatsApp."}
              </p>
            </div>
          </div>
          <button onClick={close} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-6 w-6" />
          </button>
        </div>

        {stage === "upload" ? (
          /* ---- STEP 1: Upload ---- */
          <div className="flex-1 flex flex-col items-center justify-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isParsing}
              className="w-full rounded-3xl border-2 border-dashed border-slate-200 hover:border-primary/40 bg-slate-50/60 hover:bg-primary/5 transition-all py-16 flex flex-col items-center gap-4 disabled:opacity-60"
            >
              {isParsing ? (
                <>
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="text-sm font-semibold text-slate-600">Extracting member data…</p>
                </>
              ) : (
                <>
                  <div className="h-16 w-16 rounded-2xl bg-white shadow-sm flex items-center justify-center text-primary">
                    <FileSpreadsheet className="h-8 w-8" />
                  </div>
                  <div className="text-center">
                    <p className="text-base font-bold text-slate-900">Click to upload</p>
                    <p className="text-xs text-slate-400 mt-1">Excel, CSV or image — Name, Phone, Plan</p>
                  </div>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <p className="text-[11px] text-slate-400 mt-4 text-center max-w-md">
              Use a <span className="font-semibold">CSV or Excel (.xlsx)</span> file with{" "}
              <span className="font-semibold">Name, Phone, Plan</span> columns. Only data found in your file is imported.
            </p>
          </div>
        ) : stage === "review" ? (
          /* ---- STEP 1 cont.: Editable data grid ---- */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-slate-700">{rows.length} rows</span>
                {invalidCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {invalidCount} need fixing
                  </span>
                )}
              </div>
              <Button variant="ghost" onClick={addRow} className="h-9 text-primary hover:bg-primary/5 rounded-lg">
                <Plus className="h-4 w-4 mr-1" /> Add row
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 custom-scrollbar">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-100">
                    <th className="px-3 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                    <th className="px-3 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Phone</th>
                    <th className="px-3 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Plan</th>
                    <th className="px-3 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const valid = isRowValid(r);
                    return (
                      <tr key={r.id} className={valid ? "" : "bg-amber-50/50"}>
                        <td className="px-3 py-2">
                          <Input
                            value={r.name}
                            onChange={(e) => updateRow(r.id, { name: e.target.value })}
                            placeholder="Full name"
                            className="h-9 bg-white border-slate-200 rounded-lg text-slate-900"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={r.phone}
                            onChange={(e) => updateRow(r.id, { phone: e.target.value })}
                            placeholder="+9198…"
                            className={`h-9 bg-white rounded-lg text-slate-900 ${
                              valid ? "border-slate-200" : "border-amber-300"
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select value={r.plan || undefined} onValueChange={(v) => updateRow(r.id, { plan: v })}>
                            <SelectTrigger className={`h-9 bg-white rounded-lg text-slate-900 ${r.plan ? "border-slate-200" : "border-amber-300"}`}>
                              <SelectValue placeholder="Select plan" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-200 text-slate-900">
                              {planOptions.map((p) => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => removeRow(r.id)}
                            className="text-slate-300 hover:text-red-500 transition-colors"
                            title="Remove row"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-slate-400">
                        No rows. Click “Add row” to enter members manually.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3 pt-5">
              <Button
                variant="ghost"
                onClick={() => setStage("upload")}
                className="h-12 rounded-xl font-bold text-slate-600 hover:bg-slate-100"
              >
                Back
              </Button>
              <Button
                onClick={handleSaveAndInvite}
                disabled={isSaving || validRows.length === 0}
                className="flex-1 h-12 rounded-xl bg-primary text-white font-bold shadow-lg hover:shadow-primary/20 transition-all flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Save &amp; Send Invites ({validRows.length})
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* ---- STEP 2 cont.: Send invites (real WhatsApp / optional webhook) ---- */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">
                {invites.length} member{invites.length === 1 ? "" : "s"} ready to invite
              </p>
              <Button
                onClick={sendAll}
                className="h-9 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> Send all on WhatsApp
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 divide-y divide-slate-100 custom-scrollbar">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{inv.name}</p>
                    <p className="text-xs text-slate-500">{inv.phone}</p>
                  </div>
                  <Button
                    onClick={() => openWhatsApp(inv)}
                    variant="outline"
                    className={`h-9 rounded-lg font-semibold ${
                      inv.sent
                        ? "border-green-200 text-green-600 bg-green-50"
                        : "border-slate-200 text-slate-700 hover:bg-green-50 hover:text-green-600"
                    }`}
                  >
                    {inv.sent ? (
                      <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Sent</>
                    ) : (
                      <><MessageCircle className="h-4 w-4 mr-1.5" /> Send</>
                    )}
                  </Button>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-slate-400 mt-3">
              “Send” opens WhatsApp with the invite pre-filled — you send it from your own number.
              {INVITE_WEBHOOK ? " Automated sending is also enabled via your webhook." : ""}
            </p>

            <div className="pt-4">
              <Button onClick={close} className="w-full h-12 rounded-xl bg-primary text-white font-bold">
                Done
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
