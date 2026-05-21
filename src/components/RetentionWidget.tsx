import React, { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '@/supabase';
import { Loader2, AlertCircle, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { cleanPhoneInput, isValidInternationalPhone, phoneForWaMe } from '@/lib/phone';

interface RiskyMember {
  id: string;
  name: string;
  phone: string;
  lastCheckIn: string;
  daysSinceLastCheckIn: number;
  expiresSoon: boolean;
}

export default function RetentionWidget() {
  const [riskyMembers, setRiskyMembers] = useState<RiskyMember[]>([]);
  const [retentionRate, setRetentionRate] = useState(0);
  const [totalMembers, setTotalMembers] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const retentionControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    calculateRetention();
    return () => {
      if (retentionControllerRef.current) {
        retentionControllerRef.current.abort();
      }
    };
  }, []);

  const calculateRetention = async () => {
    // Abort previous request if it's still running
    if (retentionControllerRef.current) {
      retentionControllerRef.current.abort();
    }
    retentionControllerRef.current = new AbortController();

    setIsLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const ownerId = sessionData.session?.user?.id;

      if (!ownerId) {
        setRiskyMembers([]);
        setRetentionRate(0);
        setTotalMembers(0);
        return;
      }

      const { data: gymData, error: gymError } = await supabase
        .from('gym_settings')
        .select('id')
        .eq('gym_owner_id', ownerId)
        .maybeSingle();

      if (gymError) throw gymError;

      const gymId = gymData?.id;

      // Fetch all members from the base table for the current gym
      const { data: members, error: membersError } = await supabase
        .from('profiles')
        .select('id, full_name, member_name, mobile_number, phone, status, expiry_date, gym_id, created_at')
        .eq('gym_id', gymId)
        .abortSignal(retentionControllerRef.current.signal);

      if (membersError) throw membersError;

      const memberRows = members || [];
      const memberIds = memberRows.map((member: any) => member.id).filter(Boolean);

      const { data: workoutLogs, error: workoutLogsError } = await supabase
        .from('workout_logs')
        .select('user_id, created_at')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .abortSignal(retentionControllerRef.current.signal);

      if (workoutLogsError) throw workoutLogsError;

      const latestWorkoutByUser = new Map<string, string>();
      (workoutLogs || []).forEach((log: any) => {
        if (log.user_id && !latestWorkoutByUser.has(log.user_id)) {
          latestWorkoutByUser.set(log.user_id, log.created_at);
        }
      });

      const now = new Date();
      const processedRiskyMembers: RiskyMember[] = [];
      let activeMembersCount = 0;

      memberRows.forEach((member: any) => {
        const memberName = member.full_name || member.member_name || 'Member';
        const phone = member.mobile_number || member.phone || '';
        const lastWorkoutAt = latestWorkoutByUser.get(member.id);
        const expiryDate = member.expiry_date ? new Date(member.expiry_date) : null;
        const daysToExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 3600 * 24)) : null;
        const daysSinceLastWorkout = lastWorkoutAt
          ? Math.floor((now.getTime() - new Date(lastWorkoutAt).getTime()) / (1000 * 3600 * 24))
          : 999;

        const isActive = (member.status || '').toLowerCase() === 'active';
        if (isActive) {
          activeMembersCount += 1;
        }

        const expiresSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7;
        const inactiveTooLong = daysSinceLastWorkout > 10;

        if (expiresSoon || inactiveTooLong) {
          processedRiskyMembers.push({
            id: member.id,
            name: memberName,
            phone,
            lastCheckIn: lastWorkoutAt
              ? new Date(lastWorkoutAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              : 'Never',
            daysSinceLastCheckIn: daysSinceLastWorkout,
            expiresSoon
          });
        }
      });

      const totalRegistered = memberIds.length || memberRows.length;
      setTotalMembers(totalRegistered);
      setRetentionRate(totalRegistered > 0 ? (activeMembersCount / totalRegistered) * 100 : 0);
      setRiskyMembers(processedRiskyMembers.sort((a, b) => b.daysSinceLastCheckIn - a.daysSinceLastCheckIn));
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.warn('Error calculating retention:', error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleWhatsApp = (member: RiskyMember) => {
    const cleanedPhone = cleanPhoneInput(member.phone);

    if (!cleanedPhone) {
      toast.error("Mobile number missing for this member");
      return;
    }

    if (!isValidInternationalPhone(cleanedPhone)) {
      toast.error("Invalid mobile number format");
      return;
    }

    const finalPhone = phoneForWaMe(cleanedPhone);
    
    const message = `Hi ${member.name}, we missed you at the gym! Your last workout was on ${member.lastCheckIn}. Is everything okay? Let us know if you need help getting back on track.`;
    const whatsappUrl = `https://wa.me/${finalPhone}?text=${encodeURIComponent(message)}`;
    
    window.open(whatsappUrl, '_blank');
    toast.info(`Opening WhatsApp for ${member.name}...`);
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-purple-100 p-6 h-100 flex flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
        <p className="text-sm text-muted-foreground">AI is analyzing member patterns...</p>
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
              {riskyMembers.length} Members At Risk
            </span>
          )}
        </div>
      </div>

      {riskyMembers.length === 0 ? (
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
        <div className="space-y-4 max-h-100 overflow-y-auto pr-2 custom-scrollbar">
          {riskyMembers.map((member) => (
            <div key={member.id} className="flex justify-between items-center p-4 bg-purple-50/30 rounded-2xl border border-purple-50 hover:border-purple-200 transition-colors">
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">{member.name}</h3>
                <div className="flex flex-col gap-0.5 mt-1">
                  <p className="text-xs text-slate-500">
                    Last Workout: <span className="font-semibold text-slate-700">{member.lastCheckIn}</span>
                  </p>
                  <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider">
                    {member.expiresSoon
                      ? "Expiring Soon"
                      : member.daysSinceLastCheckIn > 30
                        ? "Inactive"
                        : `${member.daysSinceLastCheckIn} days away`}
                  </p>
                </div>
              </div>
              
              <button 
                onClick={() => handleWhatsApp(member)}
                className="ml-4 p-3 bg-white text-green-600 hover:bg-green-50 border border-green-100 rounded-xl shadow-sm transition-all active:scale-95 group"
                title="Send WhatsApp Message"
              >
                <MessageSquare className="w-5 h-5 group-hover:fill-green-600 transition-all" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
