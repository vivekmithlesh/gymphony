import { useEffect, useState } from "react";
import { Loader2, Globe2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getPlatformPayoneer, setPlatformPayoneer } from "@/lib/platform-billing";

// Admin editor for the platform Payoneer details international owners pay
// subscriptions to: recipient email, account/customer id, a payment note, and
// support contacts (the latter shared with the UPI config). Mirrors AdminUpiConfig.
export function AdminPayoneerConfig() {
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState("");
  const [note, setNote] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlatformPayoneer()
      .then((p) => {
        if (cancelled) return;
        setEmail(p.email);
        setAccount(p.account);
        setNote(p.note);
        setWhatsapp(p.support_whatsapp);
        setSupportEmail(p.support_email);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await setPlatformPayoneer({
        email: email.trim(),
        account: account.trim(),
        note: note.trim(),
        whatsapp: whatsapp.trim(),
        supportEmail: supportEmail.trim(),
      });
      toast.success("Payoneer settings saved.");
    } catch (e: any) {
      toast.error(e?.message || "Could not save Payoneer settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border bg-white shadow-soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <Globe2 className="h-5 w-5 text-violet-500" /> International (Payoneer) settings
        </CardTitle>
        <CardDescription>Where international gym owners send subscription payments.</CardDescription>
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
                <Label htmlFor="pay-email">Payoneer email</Label>
                <Input id="pay-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@gymphony.app" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-account">Payoneer account / customer ID (optional)</Label>
                <Input id="pay-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. 1234567890" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-note">Payment note (optional)</Label>
              <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown to owners at checkout (e.g. add the Reference ID in the Payoneer note)" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pay-wa">Support WhatsApp</Label>
                <Input id="pay-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+91 99999 99999" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-support">Support email</Label>
                <Input id="pay-support" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="billing@gymphony.app" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Support contacts are shared with the UPI settings above.
            </p>

            <Button onClick={save} disabled={saving} className="h-11 w-full rounded-xl bg-slate-900 font-bold text-white sm:w-auto">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Payoneer settings"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default AdminPayoneerConfig;
