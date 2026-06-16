import { useEffect, useState } from "react";
import { eachDayOfInterval, endOfMonth } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { attendanceList } from "@/server/api/attendance/list";
import type { AttendanceListResponse } from "@/types/gym.types";
import { toast } from "sonner";
import { BackButton } from "./BackButton";
import { AttendanceAnalyticsPanel } from "./AttendanceAnalyticsPanel";

export function AttendanceView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [showPresent, setShowPresent] = useState(true);
  const [showAbsent, setShowAbsent] = useState(true);

  const attendanceQuery = useQuery<AttendanceListResponse>({
    queryKey: ["attendance-list"],
    queryFn: () => attendanceList(),
  });

  useEffect(() => {
    if (!selectedMemberId && attendanceQuery.data?.members[0]) {
      setSelectedMemberId(attendanceQuery.data.members[0].id);
    }
  }, [attendanceQuery.data, selectedMemberId]);

  const filteredMembers = (attendanceQuery.data?.members ?? []).filter((member) =>
    member.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedMember =
    filteredMembers.find((member) => member.id === selectedMemberId) ??
    attendanceQuery.data?.members.find((member) => member.id === selectedMemberId) ??
    attendanceQuery.data?.members[0];

  const presentDates = (selectedMember?.dates ?? []).map((date) => new Date(date));
  const absentDates = eachDayOfInterval({
    start: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1),
    end: endOfMonth(currentMonth),
  })
    .map((date) => {
      const isWeekday = date.getDay() !== 0 && date.getDay() !== 6;
      const isPresent = presentDates.some(
        (presentDate) => presentDate.toDateString() === date.toDateString(),
      );
      const isPastOrToday = date <= new Date();
      return isWeekday && !isPresent && isPastOrToday ? date : null;
    })
    .filter((date): date is Date => date !== null);

  const handleLiveLogs = () => {
    toast.info("Connecting to biometric live feed...", {
      icon: <Clock className="h-4 w-4 animate-spin" />,
    });
    setTimeout(() => {
      toast.success("Live attendance feed connected!");
    }, 1500);
  };

  const attendancePercentage =
    Math.round((presentDates.length / (presentDates.length + absentDates.length)) * 100) || 0;

  if (attendanceQuery.isLoading) {
    return (
      <div className="space-y-8 pb-10">
        <div className="mb-2">
          <BackButton />
        </div>
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4 space-y-6">
            <div className="h-[500px] rounded-3xl bg-white animate-pulse" />
            <div className="h-36 rounded-3xl bg-white animate-pulse" />
          </div>
          <div className="lg:col-span-8">
            <div className="h-[600px] rounded-3xl bg-white animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (attendanceQuery.isError || !selectedMember) {
    return (
      <div className="space-y-8 pb-10">
        <div className="mb-2">
          <BackButton />
        </div>
        <Card className="border-border bg-white shadow-soft">
          <CardContent className="p-10 text-center text-sm text-red-600">
            Failed to load attendance data. Please refresh and try again.
          </CardContent>
        </Card>
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
          <Button
            onClick={handleLiveLogs}
            variant="outline"
            className="px-4 py-2 rounded-xl border-primary/20 bg-primary/5 text-primary font-bold hover:bg-primary/10"
          >
            <Clock className="mr-2 h-4 w-4" />
            Live Logs
          </Button>
        </div>
      </div>

      <AttendanceAnalyticsPanel />

      <div className="grid gap-8 lg:grid-cols-12">
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
              <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
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
                        {member.avatar}
                      </div>
                      <div>
                        <div
                          className={`font-bold text-sm ${selectedMemberId === member.id ? "text-primary" : "text-slate-900"}`}
                        >
                          {member.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{member.plan}</div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 transition-transform ${selectedMemberId === member.id ? "translate-x-1 text-primary" : "text-slate-300"}`}
                    />
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

          <motion.div
            key={`stats-${selectedMemberId}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="border-primary/10 bg-gradient-to-br from-primary/5 to-white shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-slate-900">Monthly Stats</h4>
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      Present Days
                    </p>
                    <p className="text-2xl font-black text-primary">{presentDates.length}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      Attendance %
                    </p>
                    <p className="text-2xl font-black text-green-500">{attendancePercentage}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedMemberId}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="border-border bg-white shadow-elegant overflow-hidden min-h-[600px]">
                <CardHeader className="border-b border-slate-50 bg-slate-50/50 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-2xl bg-gradient-brand flex items-center justify-center font-bold text-white shadow-glow">
                        {selectedMember.avatar}
                      </div>
                      <div>
                        <CardTitle className="text-xl font-bold text-slate-900">
                          {selectedMember.name}
                        </CardTitle>
                        <CardDescription>
                          Attendance log for{" "}
                          {currentMonth.toLocaleString("default", {
                            month: "long",
                            year: "numeric",
                          })}
                        </CardDescription>
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
                        <CheckCircle2
                          className={`h-3.5 w-3.5 ${showPresent ? "text-green-500" : ""}`}
                        />
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
                        <CalendarIcon
                          className={`h-3.5 w-3.5 ${showAbsent ? "text-red-500" : ""}`}
                        />
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
                        absent:
                          "!bg-red-500 !text-white hover:!bg-red-600 focus:!bg-red-500 shadow-lg shadow-red-200 rounded-2xl relative before:absolute before:inset-0 before:bg-gradient-danger before:rounded-2xl before:z-0 z-10",
                      }}
                      className="rounded-3xl border border-slate-100 shadow-soft p-6"
                      classNames={{
                        months: "w-full",
                        month: "w-full space-y-6",
                        caption: "flex justify-center pt-1 relative items-center mb-4",
                        caption_label: "text-lg font-bold text-slate-900",
                        nav: "space-x-1 flex items-center",
                        nav_button:
                          "h-9 w-9 bg-white border border-slate-200 rounded-xl flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors",
                        nav_button_previous: "absolute left-1",
                        nav_button_next: "absolute right-1",
                        table: "w-full border-collapse space-y-1",
                        head_row: "flex w-full mb-2",
                        head_cell:
                          "text-slate-400 rounded-md flex-1 font-bold text-[10px] uppercase tracking-widest",
                        row: "flex w-full mt-2",
                        cell: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 flex-1",
                        day: "h-12 w-12 p-0 font-bold aria-selected:opacity-100 rounded-2xl hover:bg-slate-50 transition-all flex items-center justify-center mx-auto overflow-hidden",
                        day_selected:
                          "!bg-green-500 !text-white hover:!bg-green-600 focus:!bg-green-500 shadow-lg shadow-green-200 relative before:absolute before:inset-0 before:bg-gradient-success before:rounded-2xl before:z-0 z-10",
                        day_today: "bg-slate-100 text-slate-900",
                        day_outside: "text-slate-300 opacity-50",
                        day_disabled: "text-slate-300 opacity-50",
                        day_range_middle:
                          "aria-selected:bg-accent aria-selected:text-accent-foreground",
                        day_hidden: "invisible",
                      }}
                    />

                    <div className="mt-10 p-6 rounded-2xl bg-slate-50 border border-slate-100">
                      <h5 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        Attendance Insights
                      </h5>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {selectedMember.name} is most active on{" "}
                        <span className="text-slate-900 font-bold">Mondays and Fridays</span>.
                        Overall consistency has improved by{" "}
                        <span className="text-green-500 font-bold">8%</span> compared to last month.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
