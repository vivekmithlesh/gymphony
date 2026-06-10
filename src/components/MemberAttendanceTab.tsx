import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from '@/supabase';
import { Loader2, ChevronLeft, ChevronRight, TrendingUp, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from "@/lib/utils";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, isSameMonth, isToday, isBefore, startOfDay, addMonths, subMonths,
} from 'date-fns';

// STRICTLY READ-ONLY: the gym owner marks attendance (check_ins); the member can
// only view their own workout stats and check-in history.
interface WorkoutLog {
  id: string;
  duration_minutes: number | null;
  calories_burned: number | null;
  created_at: string;
}

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function MemberAttendanceTab({ memberId }: { memberId: string }) {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [checkInDays, setCheckInDays] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMonth = async () => {
      if (!memberId) {
        setIsLoading(false);
        return;
      }
      const monthStart = startOfMonth(currentMonth).toISOString();
      const monthEnd = endOfMonth(currentMonth).toISOString();

      try {
        setIsLoading(true);
        setError(null);

        // Workout stats for the month (workout_logs are keyed by user_id).
        const { data: logs, error: logErr } = await supabase
          .from('workout_logs')
          .select('id, duration_minutes, calories_burned, created_at')
          .eq('user_id', memberId)
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);
        if (logErr) throw logErr;
        setWorkoutLogs(logs || []);

        // Attendance (check-ins) for the month — drives the calendar markers.
        const { data: checks, error: checkErr } = await supabase
          .from('check_ins')
          .select('created_at')
          .eq('member_id', memberId)
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);
        if (checkErr) throw checkErr;
        setCheckInDays(new Set((checks || []).map((c) => dayKey(new Date(c.created_at)))));
      } catch (err: any) {
        console.error('Attendance fetch error:', err);
        setError(err?.message || 'Failed to fetch attendance data.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMonth();
  }, [memberId, currentMonth]);

  const stats = useMemo(() => {
    const sessions = workoutLogs.length;
    const calories = workoutLogs.reduce((s, l) => s + (Number(l.calories_burned) || 0), 0);
    const minutes = workoutLogs.reduce((s, l) => s + (Number(l.duration_minutes) || 0), 0);
    return { sessions, calories, minutes };
  }, [workoutLogs]);

  // Full weeks covering the visible month (Sun → Sat rows).
  const calendarDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const monthLabel = format(currentMonth, 'MMMM yyyy');

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Monthly Stats */}
      <div className="space-y-6">
        <Card className="rounded-3xl">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Monthly Stats</h3>
              <TrendingUp className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Workout Sessions</p>
                <p className="mt-1 text-3xl font-extrabold text-indigo-600">{stats.sessions}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Calories Burned</p>
                <p className="mt-1 text-3xl font-extrabold text-emerald-500">{stats.calories.toLocaleString()}</p>
              </div>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-500">
                Total workout time: <span className="font-bold text-slate-800">{stats.minutes} min</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Calendar + Insights */}
      <div className="space-y-6 lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Attendance</h2>
            <p className="text-sm text-slate-500">Attendance log for {monthLabel}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Present
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 font-semibold text-red-500">
              <XCircle className="h-3.5 w-3.5" /> Absent
            </span>
          </div>
        </div>

        <Card className="rounded-3xl">
          <CardContent className="p-6">
            {error ? (
              <div className="py-10 text-center">
                <XCircle className="mx-auto h-8 w-8 text-red-500" />
                <p className="mt-2 font-semibold text-red-700">Couldn't load attendance</p>
                <p className="mt-1 text-sm text-red-600">{error}</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <button
                    onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100"
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <h3 className="flex-1 text-center text-xl font-bold text-slate-800">{monthLabel}</h3>
                  <div className="w-18" />
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-y-2">
                    {WEEKDAYS.map((d) => (
                      <div key={d} className="pb-2 text-center text-sm font-medium text-slate-400">{d}</div>
                    ))}
                    {calendarDays.map((day) => {
                      const inMonth = isSameMonth(day, currentMonth);
                      const present = checkInDays.has(dayKey(day));
                      const today = isToday(day);
                      // Absent = a past day in this month with no check-in.
                      // Today and future days are never "absent" (the day isn't over).
                      const absent = inMonth && !present && !today && isBefore(day, startOfDay(new Date()));
                      const status = present ? 'Present' : absent ? 'Absent' : null;
                      return (
                        <div key={day.toISOString()} className="flex items-center justify-center">
                          <div
                            className={cn(
                              'flex h-10 w-10 items-center justify-center rounded-full text-sm transition-colors',
                              !inMonth && 'text-slate-300',
                              inMonth && !present && !absent && !today && 'text-slate-700',
                              present && 'bg-emerald-500 font-bold text-white shadow-md shadow-emerald-200',
                              absent && 'bg-red-50 font-semibold text-red-500 ring-1 ring-red-200',
                              today && !present && 'bg-indigo-100 font-semibold text-indigo-700',
                            )}
                            title={status ? `${status} — ${format(day, 'MMM d, yyyy')}` : format(day, 'MMM d, yyyy')}
                          >
                            {format(day, 'd')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl bg-slate-50/70">
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-indigo-500" />
              <h3 className="text-base font-bold text-slate-800">Attendance Insights</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              You logged <span className="font-bold text-slate-900">{stats.sessions} workout{stats.sessions === 1 ? '' : 's'}</span> this month.
              Total calories burned: <span className="font-bold text-slate-900">{stats.calories.toLocaleString()}</span>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
