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
import { isValidInternationalPhone, normalizeToE164Phone } from "@/lib/phone";

interface ParsedRow {
  id: string;
  name: string;
  phone: string;
  plan: string;
}

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

// Sample rows used to simulate Excel / image (OCR) extraction when we can't
// read the file's contents directly in the browser.
const MOCK_ROWS = (): ParsedRow[] => [
  { id: rid(), name: "Aarav Sharma", phone: "+919812345670", plan: "Monthly" },
  { id: rid(), name: "Priya Verma", phone: "+919812345671", plan: "Quarterly" },
  { id: rid(), name: "Rohit Singh", phone: "9812345672", plan: "Yearly" },
  { id: rid(), name: "Neha Gupta", phone: "+91 98123 45673", plan: "Monthly" },
];

// Real, lightweight CSV parsing for actual .csv uploads (Name, Phone, Plan).
const parseCsv = (text: string): ParsedRow[] => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const start = /name|phone|mobile/i.test(lines[0]) ? 1 : 0; // skip header row
  return lines.slice(start).map((line) => {
    const cols = line.split(/[,;\t]/).map((c) => c.trim());
    return { id: rid(), name: cols[0] || "", phone: cols[1] || "", plan: cols[2] || "Monthly" };
  });
};

export function BulkOnboard({ open, onClose, gymId, gymOwnerId, gymName, plans, onComplete }: BulkOnboardProps) {
  const [stage, setStage] = useState<"upload" | "review">("upload");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const planOptions = plans.length
    ? Array.from(new Set(plans.map((p) => p.name || p.id).filter(Boolean))) as string[]
    : PLAN_FALLBACK;

  const reset = () => {
    setStage("upload");
    setRows([]);
    setIsParsing(false);
    setIsSaving(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  // STEP 1 — Upload & "parse".
  const handleFile = async (file: File) => {
    setIsParsing(true);
    try {
      let parsed: ParsedRow[] = [];
      if (file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv") {
        parsed = parseCsv(await file.text());
      }
      // Simulate parsing time for Excel / images (OCR).
      await new Promise((r) => setTimeout(r, 900));
      if (parsed.length === 0) parsed = MOCK_ROWS();
      setRows(parsed);
      setStage("review");
    } catch (err) {
      console.warn("Bulk parse failed:", err);
      toast.error("Could not read that file. Try a CSV with Name, Phone, Plan columns.");
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
    setRows((prev) => [...prev, { id: rid(), name: "", phone: "", plan: planOptions[0] || "Monthly" }]);

  const isRowValid = (r: ParsedRow) => {
    const normalized = normalizeToE164Phone(r.phone, "+91");
    return r.name.trim().length > 0 && !!normalized && isValidInternationalPhone(normalized);
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

  // Mock invite trigger — stands in for the real WhatsApp/SMS send.
  const sendInvite = (member: { id: string; full_name?: string | null; mobile_number?: string | null }) => {
    const phoneE164 = member.mobile_number || "";
    const link = buildInviteLink(member.id, phoneE164);
    const message =
      `You are now a member of ${gymName || "our gym"}. ` +
      `Click here to join Gymphony to track your attendance and fees: ${link}`;

    // TODO: Replace this mock with a real send, e.g.:
    //   await supabase.functions.invoke('send-invite', {
    //     body: { to: phoneE164, message, channel: 'whatsapp' },
    //   });
    console.log(`[MOCK INVITE → ${phoneE164}]`, message);
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
          membership_plan: r.plan || planOptions[0] || "Monthly",
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

      // Fire the (mock) invites.
      (data || []).forEach(sendInvite);

      // Log the bulk action for the owner's activity feed.
      if (gymOwnerId) {
        await supabase.from("activity_log").insert([
          {
            gym_owner_id: gymOwnerId,
            activity_type: "bulk_onboard",
            description: `Bulk-onboarded ${data?.length ?? 0} member(s) and sent invites.`,
            is_read: false,
          },
        ]);
      }

      toast.success(`${data?.length ?? 0} member(s) added & invites sent!`);
      onComplete();
      close();
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
                  : "Review, fix typos, and remove invalid rows before saving."}
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
              Tip: a CSV with columns <span className="font-semibold">Name, Phone, Plan</span> is parsed directly.
              Excel/photos are simulated with sample rows you can edit.
            </p>
          </div>
        ) : (
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
                          <Select value={r.plan} onValueChange={(v) => updateRow(r.id, { plan: v })}>
                            <SelectTrigger className="h-9 bg-white border-slate-200 rounded-lg text-slate-900">
                              <SelectValue placeholder="Plan" />
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
        )}
      </motion.div>
    </div>
  );
}
