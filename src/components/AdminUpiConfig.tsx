import { useEffect, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getPlatformUpi, setPlatformUpi } from "@/lib/platform-billing";

// Admin editor for the platform UPI details owners pay subscriptions to: UPI ID,
// account holder name, an uploaded QR image, a payment note, and support contacts.
export function AdminUpiConfig() {
  const { user } = useAuth();
  const [upiId, setUpiId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlatformUpi()
      .then((u) => {
        if (cancelled) return;
        setUpiId(u.upi_id);
        setName(u.name);
        setNote(u.note);
        setQrUrl(u.qr_url);
        setWhatsapp(u.support_whatsapp);
        setEmail(u.support_email);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const uploadQr = async (file: File) => {
    if (!user?.id) return;
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      // Folder MUST start with the admin's uid — that's the payment-evidence bucket
      // insert policy (storage.foldername(name)[1] = auth.uid()).
      const path = `${user.id}/platform-qr-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("payment-evidence")
        .upload(path, file, { upsert: true, contentType: file.type || "image/png" });
      if (error) throw error;
      const { data } = supabase.storage.from("payment-evidence").getPublicUrl(path);
      setQrUrl(data.publicUrl);
      toast.success("QR uploaded. Don't forget to Save.");
    } catch (e: any) {
      toast.error(e?.message || "Could not upload the QR image.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await setPlatformUpi({
        upiId: upiId.trim(),
        name: name.trim(),
        note: note.trim(),
        qrUrl: qrUrl.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim(),
      });
      toast.success("Payment settings saved.");
    } catch (e: any) {
      toast.error(e?.message || "Could not save payment settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border bg-white shadow-soft">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900">Payment settings</CardTitle>
        <CardDescription>Where gym owners send subscription payments, and how they reach you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-upi">UPI ID</Label>
                <Input id="p-upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="platform@upi" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-name">Account holder name</Label>
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gymphony Pvt Ltd" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-note">Payment note (optional)</Label>
              <Input id="p-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown to owners at checkout" />
            </div>

            <div className="space-y-2">
              <Label>QR code</Label>
              <div className="flex flex-wrap items-center gap-4">
                {qrUrl ? (
                  <div className="relative">
                    <img
                      src={qrUrl}
                      alt="Platform UPI QR"
                      className="h-28 w-28 rounded-xl border border-slate-200 object-contain p-1"
                    />
                    <button
                      type="button"
                      onClick={() => setQrUrl("")}
                      className="absolute -right-2 -top-2 rounded-full bg-slate-900 p-1 text-white shadow"
                      aria-label="Remove QR"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-muted-foreground">
                    No QR
                  </div>
                )}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? "Uploading…" : qrUrl ? "Replace QR" : "Upload QR"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadQr(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Owners can scan this image, or use the UPI ID above. If no QR is uploaded, a QR is generated from the UPI ID.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-wa">Support WhatsApp</Label>
                <Input id="p-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+91 99999 99999" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-email">Support email</Label>
                <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@gymphony.app" />
              </div>
            </div>

            <Button onClick={save} disabled={saving || uploading} className="h-11 w-full rounded-xl bg-slate-900 font-bold text-white sm:w-auto">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save payment settings"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default AdminUpiConfig;
