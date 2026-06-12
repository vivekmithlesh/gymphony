import { useState, useEffect, useRef, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, 
  Filter, 
  MoreHorizontal, 
  Edit2, 
  CheckCircle, 
  Trash2,
  Mail,
  Phone,
  QrCode,
  X,
  Sparkles,
  DollarSign,
  MessageSquare,
  Upload
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { BackButton } from "./BackButton";
import { BulkOnboard } from "./BulkOnboard";
import { supabase } from "@/supabase";
import { QRCodeSVG } from "qrcode.react";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { isValidInternationalPhone, normalizeToE164Phone, phoneForWaMe } from "@/lib/phone";
import { isApprovedPayment } from "@/lib/revenue";
import { useAuth } from "@/lib/auth-context";

// Optimized Member Row Component
const MemberRow = memo(({ 
  member, 
  index, 
  onSelect, 
  onEdit, 
  onMarkPaid, 
  onCollectPayment,
  onDelete 
}: { 
  member: any; 
  index: number;
  onSelect: (m: any) => void;
  onEdit: (m: any) => void;
  onMarkPaid: (m: any) => void;
  onCollectPayment: (m: any) => void;
  onDelete: (m: any) => void;
}) => (
  <motion.tr
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    // Cap the stagger: a linear index*0.05 delay meant the 500th row waited 25s
    // to appear. Bound it to the first ~12 rows so the list never animates for
    // more than ~0.36s regardless of member count.
    transition={{ delay: Math.min(index, 12) * 0.03 }}
    className="hover:bg-slate-50/80 transition-colors group"
  >
    <td className="px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-brand flex items-center justify-center font-bold text-[10px] text-white">
          {(member.member_name || "M").split(' ').map((n: string) => n[0]).join('')}
        </div>
        <span className="font-semibold text-slate-900">{member.member_name}</span>
      </div>
    </td>
    <td className="px-6 py-4 text-sm text-slate-600">{member.phone}</td>
    <td className="px-6 py-4 text-sm text-slate-600">{member.membership_plan}</td>
    <td className="px-6 py-4 text-sm text-slate-600">
      <div className="font-semibold text-slate-900">₹{Number(member.amount_paid || 0).toLocaleString()}</div>
    </td>
    <td className="px-6 py-4 text-sm text-slate-600">
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={() => onSelect(member)}
        className="h-9 w-9 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-all"
      >
        <QrCode className="h-5 w-5" />
      </Button>
    </td>
    <td className="px-6 py-4">
      <Badge className={`rounded-full px-2.5 py-0.5 border-none font-bold text-[10px] shadow-sm ${
        member.status === "Active" 
          ? "bg-green-100 text-green-700" 
          : "bg-red-100 text-red-700"
      }`}>
        {member.status || "Active"}
      </Badge>
    </td>
    <td className="px-6 py-4 text-right">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40 bg-white border-slate-200 text-slate-900 rounded-xl p-1 shadow-elegant">
          <DropdownMenuItem onClick={() => {
            const message = `Hello ${member.member_name}, how can we help you today?`;
            window.open(`https://wa.me/${phoneForWaMe(member.phone || member.mobile_number || "")}?text=${encodeURIComponent(message)}`, '_blank');
          }} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-green-50 cursor-pointer text-green-600">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Chat with Us</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCollectPayment(member)} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-primary/5 cursor-pointer text-primary">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Collect Payment</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEdit(member)} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
            <Edit2 className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs font-medium">Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMarkPaid(member)} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-green-50 cursor-pointer text-green-600">
            <CheckCircle className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Mark Paid</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDelete(member)} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer">
            <Trash2 className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </td>
  </motion.tr>
));

MemberRow.displayName = "MemberRow";

export function MembersList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  // Client-side windowing: render only the first `visibleCount` matching rows so
  // the DOM stays bounded even with 1000+ members. Search/filter still run over
  // the full set; "Load more" reveals the next page. No virtualization library.
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [members, setMembers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [paymentMember, setPaymentMember] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<any[]>([]);
  const { user: authUser } = useAuth();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [gymMeta, setGymMeta] = useState<{ id: string | null; name: string }>({ id: null, name: "" });
  const [editForm, setEditForm] = useState({
    full_name: "",
    mobile_number: "",
    membership_plan: "",
    status: ""
  });

  // Current user comes from the global AuthProvider (single source of truth).
  useEffect(() => {
    setCurrentUser(authUser);
  }, [authUser]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchMembers();
    fetchAvailablePlans();
  }, [currentUser]);

  const fetchAvailablePlans = async () => {
    try {
      // First try gym_plans
      let query = supabase.from("gym_plans").select("*").order("name", { ascending: true });
      
      if (currentUser?.id) {
        query = query.eq('gym_owner_id', String(currentUser.id));
      }

      const { data: plansData, error: plansError } = await query;

      console.log("DEBUG: MembersList Plans Fetch:", { data: plansData, error: plansError, ownerId: currentUser?.id });

      if (plansError) throw plansError;

      if (plansData && plansData.length > 0) {
        setAvailablePlans(plansData);
      } else {
        // Fallback: fetch distinct from members
        let mQuery = supabase.from("members").select("membership_plan");
        
        if (currentUser?.id) {
          mQuery = mQuery.eq('gym_owner_id', String(currentUser.id));
        }

        const { data: membersData, error: membersError } = await mQuery;

        if (membersError) throw membersError;

        const distinctPlans = Array.from(new Set((membersData || [])
          .map(m => m.membership_plan)
          .filter(Boolean)))
          .map(planName => ({
            id: planName,
            name: planName,
            price: 0,
            duration: 1
          }));
        
        setAvailablePlans(distinctPlans);
      }
    } catch (err) {
      console.warn("Error in fetchAvailablePlans:", err);
      // Final fallback
      setAvailablePlans([
        { id: 'Monthly', name: 'Monthly', price: 1500, duration: 1 },
        { id: 'Quarterly', name: 'Quarterly', price: 4000, duration: 3 },
        { id: 'Yearly', name: 'Yearly', price: 12000, duration: 12 }
      ]);
    }
  };

  const fetchMembers = async () => {
    try {
      setIsLoading(true);
      const userId = authUser?.id;

      if (!userId) {
        console.error("No active auth session found for members fetch.");
        setIsLoading(false);
        return;
      }

      // 1. First get the owner's Gym ID
      const { data: gymData, error: gymError } = await supabase
        .from("gym_settings")
        .select("id, gym_name")
        .eq("gym_owner_id", userId)
        .maybeSingle();

      if (gymError) {
        console.error("Error fetching owner gym info:", gymError.message);
      }

      const gymId = gymData?.id;
      setGymMeta({ id: gymId ?? null, name: gymData?.gym_name ?? "" });
      console.log('Fetching Members with owner filters:', { userId, gymId });

      // 2. Fetch members belonging to this gym or directly added by this owner
      // We use the new Database VIEW 'members' which joins profiles data
      let query = supabase
        .from("members")
        .select("id, member_name, phone, membership_plan, status, gym_owner_id, gym_id, created_at, joining_date, expiry_date, avatar_url, amount_paid");
      
      if (gymId) {
        query = query.or(`gym_owner_id.eq.${userId},gym_id.eq.${gymId}`);
      } else {
        query = query.eq('gym_owner_id', userId);
      }

      const { data, error } = await query.order("member_name", { ascending: true });

      if (error) {
        console.error("Database Error (Members):", error.message);
        // Force reload if schema mismatch detected
        if (error.message.includes("column") || error.message.includes("does not exist")) {
          toast.error("Database schema changed. Refreshing...", {
            duration: 2000,
            onAutoClose: () => window.location.reload()
          });
        } else {
          toast.error(`Database Error: ${error.message}`);
        }
        return;
      }
      const memberRows = data || [];
      const memberIds = memberRows.map((member: any) => member.id).filter(Boolean);

      if (memberIds.length > 0) {
        // "Amount Paid" is derived from the payments ledger — counting ONLY
        // approved (Paid/Success) rows — so it matches the Dashboard and Revenue
        // pages and never shows stale profiles.amount_paid test data or
        // unapproved (pending_verification/rejected) payments.
        const { data: paymentRows, error: paymentsError } = await supabase
          .from("payments")
          .select("member_id, amount, status")
          .in("member_id", memberIds);

        if (!paymentsError) {
          const paidByMember = new Map<string, number>();
          for (const p of paymentRows || []) {
            if (!isApprovedPayment(p.status)) continue;
            paidByMember.set(
              p.member_id,
              (paidByMember.get(p.member_id) || 0) + (Number(p.amount) || 0)
            );
          }

          setMembers(
            memberRows.map((member: any) => ({
              ...member,
              amount_paid: paidByMember.get(member.id) || 0
            }))
          );
        } else {
          console.warn("Payments fetch error:", paymentsError.message);
          setMembers(memberRows);
        }
      } else {
        setMembers(memberRows);
      }
    } catch (error: any) {
      console.error("Critical error in fetchMembers:", error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredMembers = members.filter(member => {
    const matchesSearch = (member.member_name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
                          (member.phone || '').includes(debouncedSearch);
    const matchesFilter = filterStatus === "all" ||
                         (filterStatus === "active" && (member.status || '').toLowerCase() === "active") ||
                         (filterStatus === "overdue" && (member.status || '').toLowerCase() === "overdue");
    return matchesSearch && matchesFilter;
  });

  // Reset the window whenever the result set changes (new search/filter/data),
  // so "Load more" always starts from the top of the current results.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch, filterStatus, members]);

  const visibleMembers = filteredMembers.slice(0, visibleCount);
  const remainingCount = filteredMembers.length - visibleMembers.length;

  const handleDelete = async (member: any) => {
    if (!window.confirm(`Are you sure you want to delete this member?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .delete()
        .eq("id", member.id);

      if (error) throw error;

      // Update local state immediately
      setMembers(prev => prev.filter(m => m.id !== member.id));
      toast.success("Member deleted successfully");
    } catch (error: any) {
      console.warn("Delete error:", error);
    }
  };

  const handleMarkPaid = async (member: any) => {
    try {
      // Find the price for the member's plan
      const plan = availablePlans.find(p => p.name === member.membership_plan);
      const amount = plan ? plan.price : (member.membership_plan === 'Yearly' ? 12000 : (member.membership_plan === 'Quarterly' ? 4000 : 1500));
      const newTotal = Number(member.amount_paid || 0) + amount;

      // Update member status to 'Active' in profiles (since members is a view)
      const { error: memberError } = await supabase
        .from("profiles")
        .update({ status: "Active" })
        .eq("id", member.id);

      if (memberError) throw memberError;

      // Record the payment
      const { error: paymentError } = await supabase
        .from("payments")
        .insert([
          {
            member_id: member.id,
            amount: amount,
            status: 'Paid',
            payment_date: new Date().toISOString(),
          },
        ]);

      if (paymentError) {
        console.warn("Error recording payment:", paymentError);
      } else {
        // Log activity
      if (currentUser?.id) {
        await supabase
          .from("activity_log")
          .insert([
            {
              gym_owner_id: currentUser.id,
              activity_type: "payment",
              description: `Received ₹${amount.toLocaleString()} from ${member.member_name} (Marked as Paid).`,
              is_read: false,
            },
          ]);
      }
      }

      // Update local state
      setMembers(prev => prev.map(m => 
        m.id === member.id ? { ...m, status: "Active" } : m
      ));
      setMembers(prev => prev.map(m => 
        m.id === member.id ? { ...m, status: "Active" } : m
      ));
      setPaymentMember((prev: any) => prev && prev.id === member.id ? { ...prev, status: "Active", amount_paid: newTotal } : prev);

      window.dispatchEvent(new CustomEvent("member-payment-updated", {
        detail: {
          memberId: member.id,
          amount_paid: newTotal,
          status: "Active"
        }
      }));
      
      toast.success(`${member.member_name} marked as Paid and revenue recorded`);
    } catch (error: any) {
      console.warn("Mark Paid error:", error);
      toast.error("Failed to mark as paid");
    }
  };

  const handleEditClick = (member: any) => {
    // Normalize plan name to match dropdown options exactly
    const normalizePlan = (plan: string) => {
      if (!plan) return "";
      const p = plan.trim().toLowerCase();
      if (p === "monthly") return "Monthly";
      if (p === "quarterly") return "Quarterly";
      if (p === "half-yearly") return "Half-Yearly";
      if (p === "yearly") return "Yearly";
      return ""; // Default to empty if no match to force user to select
    };

    setEditingMember(member);
    setEditForm({
      full_name: member.member_name || "",
      mobile_number: member.phone || member.mobile_number || "",
      membership_plan: normalizePlan(member.membership_plan),
      status: member.status || "Active"
    });
  };

  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!editForm.full_name.trim()) {
      console.warn("Name is required");
      return;
    }
    const normalizedPhone = normalizeToE164Phone(editForm.mobile_number, "+91");
    if (!normalizedPhone || !isValidInternationalPhone(normalizedPhone)) {
      console.warn("Phone number must be a valid international number");
      return;
    }

    try {
      setIsUpdating(true);
      // Since 'members' is now a VIEW, we update the source 'profiles' table
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: editForm.full_name,
          mobile_number: normalizedPhone,
          phone: normalizedPhone,
          membership_plan: editForm.membership_plan,
          status: editForm.status
        })
        .eq("id", editingMember.id);

      if (error) throw error;

      // Refresh local state and re-fetch to ensure sync
      setMembers(prev => prev.map(m => 
        m.id === editingMember.id ? { ...m, ...editForm } : m
      ));
      
      toast.success("Member updated successfully");
      setEditingMember(null);
      
      // Re-fetch to confirm server-side update
      fetchMembers();
    } catch (error: any) {
      console.warn("Update error:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCollectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(paymentAmount);
    
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid payment amount");
      return;
    }

    try {
      setIsUpdating(true);
      const userId = authUser?.id;

      if (!userId) {
        toast.error("Session expired. Please login again.");
        return;
      }

      // 1. Record the collected payment in the ledger as an approved ('Paid')
      //    row. The "Amount Paid" column, Dashboard and Revenue pages all derive
      //    from approved payments, so writing here (not profiles.amount_paid) is
      //    what makes the collection show up. The app_fill_payment_owner trigger
      //    backfills gym_owner_id/gym_id from the members view.
      const currentPaid = Number(paymentMember.amount_paid || 0);
      const newTotal = currentPaid + amount;

      const { error: updateError } = await supabase
        .from("payments")
        .insert([{
          member_id: paymentMember.id,
          gym_owner_id: userId,
          amount: amount,
          status: 'Paid',
          payment_date: new Date().toISOString(),
        }]);

      if (updateError) throw updateError;

      setMembers(prev => prev.map(member => 
        member.id === paymentMember.id
          ? { ...member, amount_paid: newTotal }
          : member
      ));
      setPaymentMember((prev: any) => prev ? { ...prev, amount_paid: newTotal } : prev);

      // 2. Record activity
      await supabase.from("activity_log").insert({
        gym_owner_id: userId,
        activity_type: "payment",
        description: `Collected ₹${amount.toLocaleString()} from ${paymentMember.member_name}. Total paid: ₹${newTotal.toLocaleString()}.`,
        is_read: false
      });

      toast.success(`Payment of ₹${amount.toLocaleString()} collected for ${paymentMember.member_name}`);
      setPaymentMember(null);
      setPaymentAmount("");

      window.dispatchEvent(new CustomEvent("member-payment-updated", {
        detail: {
          memberId: paymentMember.id,
          amount_paid: newTotal,
          source: "collect-payment"
        }
      }));
      
      // 3. Re-fetch to update stats
      await fetchMembers();
    } catch (error: any) {
      console.error("Payment error:", error.message);
      toast.error(`Failed to collect payment: ${error.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAction = (action: string, name: string) => {
    toast.info(`${action} action triggered for ${name}`, {
      position: "bottom-center",
    });
  };

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <BackButton />
      </div>
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search members by name or phone..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white border-slate-200 rounded-xl focus:ring-primary/20 text-slate-900"
          />
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Button
            onClick={() => setIsBulkOpen(true)}
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 font-semibold hover:bg-primary/5 hover:text-primary whitespace-nowrap"
          >
            <Upload className="h-4 w-4 mr-2 text-primary" /> Upload Data
          </Button>
          <Filter className="h-4 w-4 text-muted-foreground hidden md:block" />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full md:w-45 bg-white border-slate-200 rounded-xl text-slate-900">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 text-slate-900">
              <SelectItem value="all">All Members</SelectItem>
              <SelectItem value="active">Active Only</SelectItem>
              <SelectItem value="overdue">Overdue Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk Onboarding & Auto-Invite */}
      <BulkOnboard
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        gymId={gymMeta.id}
        gymOwnerId={currentUser?.id ?? null}
        gymName={gymMeta.name}
        plans={availablePlans}
        onComplete={fetchMembers}
      />

      {/* Data Table — bounded height so a long member list scrolls inside the
          card instead of stretching the page. Sticky header keeps columns visible. */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-soft">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Member Name</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Phone Number</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Membership Plan</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Amount Paid</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">QR Code</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-6 py-8 h-16 bg-slate-50/50 mb-2"></td>
                  </tr>
                ))
              ) : visibleMembers.map((member, i) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  index={i}
                  onSelect={setSelectedMember}
                  onEdit={handleEditClick}
                  onMarkPaid={handleMarkPaid}
                  onCollectPayment={setPaymentMember}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
          {!isLoading && remainingCount > 0 && (
            <div className="flex items-center justify-center gap-3 py-4 border-t border-slate-100 bg-white">
              <span className="text-xs text-muted-foreground">
                Showing {visibleMembers.length} of {filteredMembers.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="h-8 rounded-lg border-slate-200 text-slate-700 font-semibold hover:bg-primary/5 hover:text-primary"
              >
                Load more
              </Button>
            </div>
          )}
          {!isLoading && filteredMembers.length === 0 && (
            <div className="py-20 text-center space-y-3">
              <div className="h-12 w-12 bg-white/5 rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                <Search className="h-6 w-6" />
              </div>
              <p className="text-muted-foreground">No members found matching your search.</p>
            </div>
          )}
        </div>
      </div>

      {/* QR Code Modal */}
      <AnimatePresence>
        {selectedMember && (
          <div 
            className="fixed inset-0 z-100 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedMember(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-white rounded-[2.5rem] overflow-hidden shadow-2xl p-8"
            >
              <div className="flex flex-col items-center text-center space-y-6">
                <div className="flex w-full items-center justify-between mb-2">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <QrCode className="h-5 w-5" />
                  </div>
                  <button onClick={() => setSelectedMember(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="relative p-6 bg-slate-50 rounded-3xl border-2 border-slate-100 flex flex-col items-center gap-4">
                  <QRCodeSVG 
                    value={selectedMember.id} 
                    size={200}
                    level="H"
                    includeMargin={true}
                    className="rounded-xl shadow-sm bg-white"
                  />
                  <div className="text-[10px] font-mono text-slate-400 select-all">
                    {selectedMember.id}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900">{selectedMember.member_name}</h3>
                  <p className="text-sm text-slate-500 font-medium">Scan this QR at the gym entrance</p>
                </div>

                <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 text-primary rounded-full text-xs font-bold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  {selectedMember.membership_plan} Member
                </div>

                <Button 
                  onClick={() => window.print()} 
                  className="w-full h-12 rounded-xl bg-slate-900 text-white font-bold shadow-lg hover:shadow-slate-200 transition-all mt-4"
                >
                  Print ID Card
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Collect Payment Modal */}
      <AnimatePresence>
        {paymentMember && (
          <div 
            className="fixed inset-0 z-100 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => setPaymentMember(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl p-8 relative z-101"
            >
              <div className="flex flex-col space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <DollarSign className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Collect Payment</h3>
                      <p className="text-sm text-slate-500">Collect fees from {paymentMember.member_name}</p>
                    </div>
                  </div>
                  <button onClick={() => setPaymentMember(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl space-y-2 border border-slate-100">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Current Paid:</span>
                    <span className="font-bold text-slate-900">₹{Number(paymentMember.amount_paid || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Membership Plan:</span>
                    <span className="font-bold text-slate-900">{paymentMember.membership_plan}</span>
                  </div>
                </div>

                <form onSubmit={handleCollectPayment} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 ml-1">Payment Amount (₹)</label>
                    <Input 
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="e.g. 2500"
                      className="h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-primary/20 text-slate-900"
                      autoFocus
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button 
                      type="button"
                      variant="ghost"
                      onClick={() => setPaymentMember(null)}
                      className="flex-1 h-12 rounded-xl font-bold text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit"
                      disabled={isUpdating}
                      className="flex-1 h-12 rounded-xl bg-primary text-white font-bold shadow-lg hover:shadow-primary/20 transition-all"
                    >
                      {isUpdating ? "Processing..." : "Collect Payment"}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Member Modal */}
      <AnimatePresence>
        {editingMember && (
          <div 
            className="fixed inset-0 z-100 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => setEditingMember(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl p-8 relative z-101"
            >
              <div className="flex flex-col space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <Edit2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Edit Member</h3>
                      <p className="text-sm text-slate-500">Update details for {editingMember.member_name}</p>
                    </div>
                  </div>
                  <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <form onSubmit={handleUpdateMember} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 ml-1">Full Name</label>
                    <Input 
                      value={editForm.full_name}
                      onChange={(e) => setEditForm(prev => ({ ...prev, full_name: e.target.value }))}
                      placeholder="Enter member's full name"
                      className="h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-primary/20 text-slate-900"
                    />
                  </div>

                  <div className="space-y-2">
                    <InternationalPhoneInput
                      id="member-phone"
                      label="Phone Number"
                      value={editForm.mobile_number}
                      onChange={(value) => setEditForm(prev => ({ ...prev, mobile_number: value }))}
                      placeholder="e.g. +919876543210"
                      defaultCountryCode="+91"
                      error={editForm.mobile_number && !isValidInternationalPhone(editForm.mobile_number) ? "Please enter a valid international phone number" : undefined}
                      className="group"
                      inputClassName="bg-slate-50 border-slate-200 rounded-xl text-slate-900"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 ml-1">Membership Plan</label>
                    <Select 
                      value={editForm.membership_plan} 
                      onValueChange={(val) => setEditForm(prev => ({ ...prev, membership_plan: val }))}
                    >
                      <SelectTrigger className="h-12 bg-slate-50 border-slate-200 rounded-xl text-slate-900">
                        <SelectValue placeholder="Select a plan" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900 z-110" position="popper" sideOffset={5}>
                        <SelectItem value="Monthly">Monthly</SelectItem>
                        <SelectItem value="Quarterly">Quarterly</SelectItem>
                        <SelectItem value="Half-Yearly">Half-Yearly</SelectItem>
                        <SelectItem value="Yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button 
                      type="button"
                      variant="ghost"
                      onClick={() => setEditingMember(null)}
                      className="flex-1 h-12 rounded-xl font-bold text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit"
                      disabled={isUpdating}
                      className="flex-1 h-12 rounded-xl bg-slate-900 text-white font-bold shadow-lg hover:shadow-slate-200 transition-all"
                    >
                      {isUpdating ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
