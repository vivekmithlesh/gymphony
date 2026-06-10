import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/supabase';
import { AlertCircle, AlertTriangle, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { cleanPhoneInput, isValidInternationalPhone, phoneForWaMe } from '@/lib/phone';

interface RiskyMember {
  id: string;
  name: string;
  phone: string;
  lastCheckIn: string;          // 'Never' or a formatted date
  daysSinceLastCheckIn: number;
  neverVisited: boolean;
  expiringSoon: boolean;
}

// A member with an active plan who has not checked in for this many days is "At Risk".
const RISK_DAYS = 10;
const DAY_MS = 1000 * 60 * 60 * 24;

export default function RetentionWidget() {
  const [riskyMembers, setRiskyMembers] = useState<RiskyMember[]>([]);
  const [retentionRate, setRetentionRate] = useState(0);
  const [totalActive, setTotalActive] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const retentionControllerRef = useRef<AbortController | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    calculateRetention();
    return () => {
      if (retentionControllerRef.current) {
        retentionControllerRef.current.abort();
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAbortError = (error: any) =>
    error?.name === 'AbortError' ||
    String(error?.message || '').includes('abort') ||
    String(error?.message || '').includes('Lock broken');

  const calculateRetention = async () => {
    // Abort any in-flight request first.
    if (retentionControllerRef.current) {
      retentionControllerRef.current.abort();
    }
    retentionControllerRef.current = new AbortController();
    const signal = retentionControllerRef.current.signal;

    setIsLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const ownerId = sessionData.session?.user?.id;

      if (!ownerId) {
        setRiskyMembers([]);
        setRetentionRate(0);
        setTotalActive(0);
        return;
      }

      const { data: gymData, error: gymError } = await supabase
        .from('gym_settings')
        .select('id')
        .eq('gym_owner_id', ownerId)
        .maybeSingle();

      if (gymError) throw gymError;
      const gymId = gymData?.id;

      // Subscribe once to THIS gym's check-ins so a kiosk scan instantly
      // recalculates risk and clears the member from the list — no refresh.
      if (gymId && !realtimeChannelRef.current) {
        realtimeChannelRef.current = supabase
          .channel(`retention-${gymId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `gym_id=eq.${gymId}` },
            () => calculateRetention()
          )
          .subscribe();
      }

      // 1. Fetch members from the members table (gym-scoped) and keep the active ones.
      let membersQuery = supabase
        .from('members')
        .select('id, full_name, mobile_number, phone, status, expiry_date, created_at');
      membersQuery = gymId
        ? membersQuery.or(`gym_owner_id.eq.${ownerId},gym_id.eq.${gymId}`)
        : membersQuery.eq('gym_owner_id', ownerId);

      const { data: members, error: membersError } = await membersQuery.abortSignal(signal);
      if (membersError) {
        if (isAbortError(membersError)) return;
        throw membersError;
      }

      const activeMembers = (members || []).filter(
        (m: any) => (m.status || '').toLowerCase() === 'active'
      );
      const activeCount = activeMembers.length;

      if (activeCount === 0) {
        setRiskyMembers([]);
        setTotalActive(0);
        setRetentionRate(0);
        return;
      }

      // 2. Join each member's most recent check-in from the attendance table.
      const memberIds = activeMembers.map((m: any) => m.id);
      let checkInQuery = supabase
        .from('check_ins')
        .select('member_id, check_in_time')
        .order('check_in_time', { ascending: false });
      checkInQuery = gymId
        ? checkInQuery.eq('gym_id', gymId)
        : checkInQuery.in('member_id', memberIds);

      const { data: checkIns, error: checkInsError } = await checkInQuery.abortSignal(signal);
      if (checkInsError) {
        if (isAbortError(checkInsError)) return;
        throw checkInsError;
      }

      // First occurrence per member is the latest (query is ordered desc).
      const latestCheckInByMember = new Map<string, string>();
      (checkIns || []).forEach((c: any) => {
        if (c.member_id && !latestCheckInByMember.has(c.member_id)) {
          latestCheckInByMember.set(c.member_id, c.check_in_time);
        }
      });

      // 3. Flag active members with no check-in in the last RISK_DAYS days.
      const now = new Date();
      const processedRisky: RiskyMember[] = [];

      activeMembers.forEach((m: any) => {
        const name = m.full_name || 'Member';
        const phone = m.mobile_number || m.phone || '';
        const lastCheckInRaw = latestCheckInByMember.get(m.id);
        const neverVisited = !lastCheckInRaw;

        // For members who never checked in, measure inactivity from join date so a
        // brand-new member isn't unfairly flagged on day one.
        const reference = lastCheckInRaw
          ? new Date(lastCheckInRaw)
          : (m.created_at ? new Date(m.created_at) : null);
        const daysSince = reference
          ? Math.floor((now.getTime() - reference.getTime()) / DAY_MS)
          : 999;

        if (daysSince > RISK_DAYS) {
          const expiryDate = m.expiry_date ? new Date(m.expiry_date) : null;
          const daysToExpiry = expiryDate
            ? Math.ceil((expiryDate.getTime() - now.getTime()) / DAY_MS)
            : null;

          processedRisky.push({
            id: m.id,
            name,
            phone,
            lastCheckIn: lastCheckInRaw
              ? new Date(lastCheckInRaw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              : 'Never',
            daysSinceLastCheckIn: daysSince,
            neverVisited,
            expiringSoon: daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7,
          });
        }
      });

      const atRiskCount = processedRisky.length;
      setTotalActive(activeCount);
      setRetentionRate(((activeCount - atRiskCount) / activeCount) * 100);
      setRiskyMembers(
        processedRisky.sort((a, b) => b.daysSinceLastCheckIn - a.daysSinceLastCheckIn)
      );
    } catch (error: any) {
      if (!isAbortError(error)) {
        console.warn('Error calculating retention:', error);
        // Fail into a safe, non-broken empty state.
        setRiskyMembers([]);
        setRetentionRate(0);
        setTotalActive(0);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Nudge / Remind — opens a pre-filled WhatsApp message for the at-risk member.
  const handleNudge = (member: RiskyMember) => {
    const cleanedPhone = cleanPhoneInput(member.phone);

    if (!cleanedPhone) {
      toast.error('Mobile number missing for this member');
      return;
    }
    if (!isValidInternationalPhone(cleanedPhone)) {
      toast.error('Invalid mobile number format');
      return;
    }

    const finalPhone = phoneForWaMe(cleanedPhone);
    const lastSeen = member.neverVisited ? 'a while' : `your last visit on ${member.lastCheckIn}`;
    const message = `Hi ${member.name}, we've missed you at the gym! It's been ${lastSeen}. Is everything okay? Let us know if you need help getting back on track. 💪`;
    const whatsappUrl = `https://wa.me/${finalPhone}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
    toast.info(`Opening WhatsApp for ${member.name}...`);
  };

  // Clean skeleton loader while data + risk calculations run.
  if (isLoading) {
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-purple-100 p-6 min-h-100">
        <div className="flex justify-between items-center mb-6">
          <div className="h-6 w-48 bg-slate-100 rounded-lg animate-pulse" />
          <div className="h-6 w-28 bg-slate-100 rounded-full animate-pulse" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
              <div className="flex items-center gap-3 flex-1">
                <div className="h-10 w-10 rounded-full bg-slate-200 animate-pulse" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
                  <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                </div>
              </div>
              <div className="h-9 w-20 bg-slate-100 rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-purple-100 p-6 min-h-100">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          🧠 AI Retention Engine
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-3 py-1 rounded-full">
            Retention Rate {retentionRate.toFixed(1)}%
          </span>
          {riskyMembers.length > 0 && (
            <span className="text-xs font-semibold bg-red-100 text-red-600 px-3 py-1 rounded-full animate-pulse">
              {riskyMembers.length} At Risk
            </span>
          )}
        </div>
      </div>

      {riskyMembers.length === 0 ? (
        // Safe state.
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-green-500" />
          </div>
          <h3 className="font-bold text-gray-900 mb-1">Great Job!</h3>
          <p className="text-sm text-slate-500 max-w-50">
            No members are currently at risk of dropping out.
          </p>
        </div>
      ) : (
        // Warning state — compact list with a soft red/orange aesthetic.
        <div className="space-y-3 max-h-100 overflow-y-auto pr-2 custom-scrollbar">
          {riskyMembers.map((member) => (
            <div
              key={member.id}
              className="flex justify-between items-center p-4 bg-linear-to-r from-red-50 to-orange-50/40 rounded-2xl border border-red-100 hover:border-red-200 transition-colors"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-red-500 shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 truncate">{member.name}</h3>
                  <p className="text-xs text-red-600 font-bold">
                    {member.neverVisited
                      ? 'Never checked in'
                      : `${member.daysSinceLastCheckIn} days since last visit`}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    Last visit: {member.lastCheckIn}
                    {member.expiringSoon ? ' • Plan expiring soon' : ''}
                  </p>
                </div>
              </div>

              <button
                onClick={() => handleNudge(member)}
                className="ml-3 px-4 py-2 bg-white text-red-600 hover:bg-red-600 hover:text-white border border-red-200 rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
                title="Send a reminder"
              >
                <Bell className="w-3.5 h-3.5" />
                Nudge
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
