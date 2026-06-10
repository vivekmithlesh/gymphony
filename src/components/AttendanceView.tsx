import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, 
  Calendar as CalendarIcon, 
  CheckCircle2, 
  Clock,
  ChevronRight,
  TrendingUp,
  Loader2,
  Check,
  X
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { BackButton } from "./BackButton";
import { supabase } from "@/supabase";

interface Member {
  id: string;
  user_id?: string | null;
  full_name: string;
  member_name?: string | null;
  mobile_number: string;
  membership_plan: string;
  avatar_url?: string | null;
  gym_id?: string | null;
}

interface CheckIn {
  id: string;
  member_id: string;
  created_at: string;
}

interface WorkoutLog {
  id: string;
  user_id?: string | null;
  activity_type?: string | null;
  duration_minutes?: number | null;
  calories_burned?: number | null;
  created_at: string;
}

export function AttendanceView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date(2026, 4)); // May 2026
  const [showPresent, setShowPresent] = useState(true);
  const [showAbsent, setShowAbsent] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentGymId, setCurrentGymId] = useState<string | null>(null);

  const checkInsControllerRef = useRef<AbortController | null>(null);
  const workoutLogsControllerRef = useRef<AbortController | null>(null);

  // Initialize: Wait for Auth and then Fetch members
  useEffect(() => {
    const controller = new AbortController();
    
    const initialize = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && !controller.signal.aborted) {
          const { data: gymData, error: gymError } = await supabase
            .from("gym_settings")
            .select("id")
            .eq("gym_owner_id", session.user.id)
            .maybeSingle();

          if (gymError) {
            console.warn("Gym lookup error:", gymError.message);
          }

          const gymId = gymData?.id || null;
          setCurrentGymId(gymId);
          await fetchMembers(controller.signal, gymId);
        }
      } catch (error) {
        console.warn("Auth initialization error:", error);
      }
    };

    initialize();

    return () => {
      controller.abort();
    };
  }, []);

  // Fetch check-ins when selected member, month, or refreshKey changes
  useEffect(() => {
    if (selectedMemberId) {
      fetchCheckIns();
      fetchWorkoutStats();
    }
    return () => {
      if (checkInsControllerRef.current) {
        checkInsControllerRef.current.abort();
      }
      if (workoutLogsControllerRef.current) {
        workoutLogsControllerRef.current.abort();
      }
    };
  }, [selectedMemberId, currentMonth, refreshKey, currentGymId]);

  const fetchMembers = async (signal: AbortSignal, gymId?: string | null, retryCount = 0) => {
    console.log('Attempting to fetch members (Simple Fetch)...');
    setIsLoading(true);
    
    try {
      if (!gymId) {
        setMembers([]);
        setSelectedMemberId(null);
        return;
      }

      // Fetch members from profiles for the current gym only
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, mobile_number, membership_plan, avatar_url, gym_id')
        .eq('gym_id', gymId)
        .order('full_name')
        .abortSignal(signal);

      if (error) {
        if (error.name === 'AbortError' || error.message?.includes('abort') || error.message?.includes('Lock broken')) {
          return;
        }
        console.warn('Attendance fetch error details:', error.message);
        return;
      }

      const memberRows = data || [];
      const uniqueMembersById = Array.from(
        new Map(memberRows.map((member: any) => [member.id, member])).values()
      );

      setMembers(uniqueMembersById);
      if (uniqueMembersById.length > 0 && !selectedMemberId) {
        setSelectedMemberId(uniqueMembersById[0].id);
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('abort') || error.message?.includes('Lock broken')) {
        return;
      }

      console.warn('Attendance fetch error:', error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWorkoutStats = async () => {
    if (!selectedMemberId || !currentGymId) {
      setWorkoutLogs([]);
      return;
    }

    if (workoutLogsControllerRef.current) {
      workoutLogsControllerRef.current.abort();
    }
    workoutLogsControllerRef.current = new AbortController();

    try {
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString();
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const { data, error } = await supabase
        .from("workout_logs")
        .select("id, user_id, activity_type, duration_minutes, calories_burned, created_at")
        .eq("user_id", selectedMemberId)
        .eq("gym_id", currentGymId)
        .gte("created_at", startOfMonth)
        .lte("created_at", endOfMonth)
        .abortSignal(workoutLogsControllerRef.current.signal);

      if (error) {
        if (error.name === 'AbortError' || error.message?.includes('abort') || error.message?.includes('Lock broken')) {
          return;
        }
        console.warn("Workout stats fetch error:", error.message);
        setWorkoutLogs([]);
        return;
      }

      setWorkoutLogs(data || []);
    } catch (error: any) {
      if (error.name !== 'AbortError' && !error.message?.includes('abort') && !error.message?.includes('Lock broken')) {
        console.warn("Silent fetch error in fetchWorkoutStats:", error.message);
      }
    }
  };

  const fetchCheckIns = async () => {
    if (!selectedMemberId) return;
    
    // Use the dedicated check-ins controller
    if (checkInsControllerRef.current) {
      checkInsControllerRef.current.abort();
    }
    checkInsControllerRef.current = new AbortController();

    try {
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString();
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59).toISOString();

      // Simple fetch (no owner filter)
      const { data, error } = await supabase
        .from("check_ins")
        .select("id, member_id, created_at")
        .eq("member_id", selectedMemberId)
        .gte("created_at", startOfMonth)
        .lte("created_at", endOfMonth)
        .abortSignal(checkInsControllerRef.current.signal);

      if (error) {
        if (error.name === 'AbortError' || error.message?.includes('abort') || error.message?.includes('Lock broken')) {
          return;
        }
        console.warn("Check-ins fetch error:", error.message);
        return;
      }
      setCheckIns(data || []);
    } catch (error: any) {
      if (error.name !== 'AbortError' && !error.message?.includes('abort') && !error.message?.includes('Lock broken')) {
        console.warn("Silent fetch error in fetchCheckIns:", error.message);
      }
    }
  };

  const uniqueMembers = useMemo(() => {
    const seen = new Set<string>();

    return members.filter((member) => {
      const uniqueKey = member.user_id || member.id;

      if (seen.has(uniqueKey)) {
        return false;
      }

      seen.add(uniqueKey);
      return true;
    });
  }, [members]);

  const filteredMembers = useMemo(() => 
    uniqueMembers.filter(m => 
      (m.full_name || m.member_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    ), [uniqueMembers, searchQuery]
  );

  const selectedMember = useMemo(() => 
    uniqueMembers.find(m => m.id === selectedMemberId), 
    [uniqueMembers, selectedMemberId]
  );

  const monthlyWorkoutStats = useMemo(() => {
    const totalWorkouts = workoutLogs.length;
    const totalDuration = workoutLogs.reduce((sum, log) => sum + (Number(log.duration_minutes) || 0), 0);
    const totalCalories = workoutLogs.reduce((sum, log) => sum + (Number(log.calories_burned) || 0), 0);

    return { totalWorkouts, totalDuration, totalCalories };
  }, [workoutLogs]);

  const presentDates = useMemo(() => 
    checkIns.map(ci => new Date(ci.created_at)),
    [checkIns]
  );

  const isTodayPresent = useMemo(() => {
    const today = new Date();
    // Use May 1, 2026 as "today"
    const simulatedToday = new Date(2026, 4, 1); 
    const targetDate = today.getFullYear() === 2026 && today.getMonth() === 4 ? today : simulatedToday;
    
    return presentDates.some(p => 
      p.getDate() === targetDate.getDate() && 
      p.getMonth() === targetDate.getMonth() && 
      p.getFullYear() === targetDate.getFullYear()
    );
  }, [presentDates]);

  // Generate absent dates (weekdays that are not in presentDates and are in the past/present month)
  const absentDates = useMemo(() => {
    const dates: Date[] = [];
    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const simulatedToday = new Date(2026, 4, 1);
    
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
      const isWeekday = date.getDay() !== 0 && date.getDay() !== 6;
      const isPresent = presentDates.some(p => p.toDateString() === date.toDateString());
      const isPastOrToday = date <= simulatedToday;

      if (isWeekday && !isPresent && isPastOrToday) {
        dates.push(date);
      }
    }
    return dates;
  }, [currentMonth, presentDates]);

  const toggleAttendance = async (status: 'present' | 'absent') => {
    if (!selectedMemberId) {
      console.warn('Toggle Attendance: No member selected');
      return;
    }
    setIsActionLoading(true);
    
    try {
      const now = new Date();
      // If the real date is May 2026, use the real time. Otherwise use May 1st, 2026 at current time.
      const simulatedTime = new Date(2026, 4, 1, now.getHours(), now.getMinutes(), now.getSeconds());
      const attendanceTime = (now.getFullYear() === 2026 && now.getMonth() === 4) ? now : simulatedTime;

      const startOfDay = new Date(attendanceTime.getFullYear(), attendanceTime.getMonth(), attendanceTime.getDate(), 0, 0, 0).toISOString();
      const endOfDay = new Date(attendanceTime.getFullYear(), attendanceTime.getMonth(), attendanceTime.getDate(), 23, 59, 59).toISOString();

      console.log('Attempting attendance update:', { 
        status, 
        member_id: selectedMemberId, 
        time: attendanceTime.toISOString()
      });

      if (status === 'present') {
        const { error } = await supabase
          .from('check_ins')
          .insert([{
            member_id: selectedMemberId,
            created_at: attendanceTime.toISOString(),
            // Adding extra fields if they exist in schema, but Supabase handles created_at
          }]);
        
        if (error) {
          console.warn('Supabase Update Warning (Insert):', error);
          toast.error("Failed to mark present");
          return;
        }
      } else {
        const { error } = await supabase
          .from('check_ins')
          .delete()
          .eq('member_id', selectedMemberId)
          .gte('created_at', startOfDay)
          .lte('created_at', endOfDay);
        
        if (error) {
          console.warn('Supabase Update Warning (Delete):', error);
          toast.error("Failed to mark absent");
          return;
        }
      }

      setRefreshKey(prev => prev + 1);
      toast.success(`Marked as ${status}`);
    } catch (error: any) {
      console.warn('Attendance toggle catch block:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  if (isLoading && !selectedMemberId) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="mb-2">
        <BackButton />
      </div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="font-display text-3xl font-bold md:text-4xl">
            Member <span className="text-gradient-brand">Attendance</span>
          </h1>
          <p className="mt-1 text-muted-foreground">
            Track and manage daily attendance logs for your gym members.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
            <button
              onClick={() => toggleAttendance('present')}
              disabled={isActionLoading || isTodayPresent}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                isTodayPresent 
                ? "bg-green-500 text-white shadow-lg shadow-green-200" 
                : "hover:bg-white text-slate-500"
              } disabled:opacity-50`}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {!isActionLoading && <Check className="h-4 w-4" />}
              Present
            </button>
            <button
              onClick={() => toggleAttendance('absent')}
              disabled={isActionLoading || !isTodayPresent}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                !isTodayPresent 
                ? "bg-red-500 text-white shadow-lg shadow-red-200" 
                : "hover:bg-white text-slate-500"
              } disabled:opacity-50`}
            >
              {isActionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {!isActionLoading && <X className="h-4 w-4" />}
              Absent
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Members Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-border bg-white shadow-soft overflow-hidden">
            <CardHeader className="pb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search members..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-slate-50 border-slate-200 rounded-xl focus:ring-primary/20 h-11"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100 max-h-125 overflow-y-auto custom-scrollbar">
                {filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => setSelectedMemberId(member.id)}
                    className={`w-full flex items-center justify-between p-4 transition-all text-left ${
                      selectedMemberId === member.id 
                        ? "bg-primary/5 border-l-4 border-primary" 
                        : "hover:bg-slate-50 border-l-4 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-gradient-brand flex items-center justify-center font-bold text-xs text-white">
                        {member.avatar_url ? (
                          <img src={member.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
                        ) : (
                          member.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U'
                        )}
                      </div>
                      <div>
                        <div className={`font-bold text-sm ${selectedMemberId === member.id ? "text-primary" : "text-slate-900"}`}>
                          {member.full_name || member.member_name || 'Member'}
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">{member.membership_plan?.toLowerCase()}</div>
                      </div>
                    </div>
                    <ChevronRight className={`h-4 w-4 transition-transform ${selectedMemberId === member.id ? "translate-x-1 text-primary" : "text-slate-300"}`} />
                  </button>
                ))}
                {filteredMembers.length === 0 && (
                  <div className="p-10 text-center text-muted-foreground text-sm">
                    No members found.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats for selected member */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`stats-${selectedMemberId}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Card className="border-primary/10 bg-linear-to-br from-primary/5 to-white shadow-soft">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-slate-900">Monthly Stats</h4>
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Workout Sessions</p>
                      <p className="text-2xl font-black text-primary">{monthlyWorkoutStats.totalWorkouts}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Calories Burned</p>
                      <p className="text-2xl font-black text-green-500">{monthlyWorkoutStats.totalCalories.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-muted-foreground">
                    Total workout time: <span className="font-bold text-slate-900">{monthlyWorkoutStats.totalDuration} min</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Calendar View */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedMemberId}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              {selectedMember && (
                <Card className="border-border bg-white shadow-elegant overflow-hidden min-h-150">
                  <CardHeader className="border-b border-slate-50 bg-slate-50/50 p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-2xl bg-gradient-brand flex items-center justify-center font-bold text-white shadow-glow">
                          {selectedMember.avatar_url ? (
                            <img src={selectedMember.avatar_url} alt="" className="h-full w-full rounded-2xl object-cover" />
                          ) : (
                            selectedMember.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U'
                          )}
                        </div>
                        <div>
                          <CardTitle className="text-xl font-bold text-slate-900">{selectedMember.full_name || selectedMember.member_name || 'Member'}</CardTitle>
                          <CardDescription>Attendance log for {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</CardDescription>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-2">
                        <button 
                          onClick={() => setShowPresent(!showPresent)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                            showPresent 
                              ? "bg-green-50 text-green-700 border-green-100 shadow-sm" 
                              : "bg-slate-50 text-slate-400 border-slate-100 opacity-60"
                          }`}
                        >
                          <CheckCircle2 className={`h-3.5 w-3.5 ${showPresent ? "text-green-500" : ""}`} />
                          Present
                        </button>
                        <button 
                          onClick={() => setShowAbsent(!showAbsent)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                            showAbsent 
                              ? "bg-red-50 text-red-700 border-red-100 shadow-sm" 
                              : "bg-slate-50 text-slate-400 border-slate-100 opacity-60"
                          }`}
                        >
                          <CalendarIcon className={`h-3.5 w-3.5 ${showAbsent ? "text-red-500" : ""}`} />
                          Absent
                        </button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8 flex justify-center items-center">
                    <div className="w-full max-w-md">
                      <Calendar
                        mode="multiple"
                        selected={showPresent ? presentDates : []}
                        month={currentMonth}
                        onMonthChange={setCurrentMonth}
                        modifiers={{
                          absent: showAbsent ? absentDates : [],
                        }}
                        modifiersClassNames={{
                          absent: "!bg-red-500 !text-white hover:!bg-red-600 focus:!bg-red-500 shadow-lg shadow-red-200 rounded-2xl relative before:absolute before:inset-0 before:bg-gradient-danger before:rounded-2xl before:z-0 z-10",
                        }}
                        className="rounded-3xl border border-slate-100 shadow-soft p-6"
                        classNames={{
                          months: "w-full",
                          month: "w-full space-y-6",
                          caption: "flex justify-center pt-1 relative items-center mb-4",
                          caption_label: "text-lg font-bold text-slate-900",
                          nav: "space-x-1 flex items-center",
                          nav_button: "h-9 w-9 bg-white border border-slate-200 rounded-xl flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors",
                          nav_button_previous: "absolute left-1",
                          nav_button_next: "absolute right-1",
                          table: "w-full border-collapse space-y-1",
                          head_row: "flex w-full mb-2",
                          head_cell: "text-slate-400 rounded-md flex-1 font-bold text-[10px] uppercase tracking-widest",
                          row: "flex w-full mt-2",
                          cell: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 flex-1",
                          day: "h-12 w-12 p-0 font-bold aria-selected:opacity-100 rounded-2xl hover:bg-slate-50 transition-all flex items-center justify-center mx-auto overflow-hidden",
                          day_selected: "!bg-green-500 !text-white hover:!bg-green-600 focus:!bg-green-500 shadow-lg shadow-green-200 relative before:absolute before:inset-0 before:bg-gradient-success before:rounded-2xl before:z-0 z-10",
                          day_today: "bg-slate-100 text-slate-900",
                          day_outside: "text-slate-300 opacity-50",
                          day_disabled: "text-slate-300 opacity-50",
                          day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
                          day_hidden: "invisible",
                        }}
                      />
                      
                      <div className="mt-10 p-6 rounded-2xl bg-slate-50 border border-slate-100">
                        <h5 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-primary" />
                          Attendance Insights
                        </h5>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {selectedMember.full_name || selectedMember.member_name || 'This member'} logged <span className="text-slate-900 font-bold">{monthlyWorkoutStats.totalWorkouts} workouts</span> this month.
                          Total calories burned: <span className="text-slate-900 font-bold">{monthlyWorkoutStats.totalCalories.toLocaleString()}</span>.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
