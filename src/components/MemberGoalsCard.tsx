import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { supabase } from "@/supabase";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Check, X, Pencil, Dumbbell, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { PremiumSyncing } from "@/components/PremiumLoader";

type Category = "diet" | "exercise";

// A goal DEFINITION (the recurring label). Whether it's checked is derived
// per-day from member_goal_completions, not stored here.
interface Goal {
  id: string;
  member_id: string;
  category: Category;
  label: string;
  position: number;
}

// The member's LOCAL calendar date as YYYY-MM-DD. We intentionally compute this
// on the client (the browser knows the member's timezone) so the checklist rolls
// over at *their* midnight, not the database server's UTC midnight.
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Suggested starter goals seeded once per member/category (they can edit/delete).
const SEED: Record<Category, string[]> = {
  diet: ["Hit 120g protein", "Drink 3L water", "Keep the post-workout meal clean"],
  exercise: ["20 minutes cardio", "Complete the strength block", "Finish mobility and stretching"],
};

export function MemberGoalsCard({ memberId, category, title }: { memberId: string; category: Category; title: string }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  // Ids of goals completed *today* (local date). The source of truth for which
  // checkboxes are ticked. Cleared/re-derived whenever `today` changes.
  const [doneToday, setDoneToday] = useState<Set<string>>(new Set());
  const [today, setToday] = useState<string>(localToday());
  const [isLoading, setIsLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const seededRef = useRef(false);

  const fetchGoals = useCallback(async () => {
    const day = localToday();
    try {
      const { data, error } = await supabase
        .from("member_goals")
        .select("id, member_id, category, label, position")
        .eq("member_id", memberId)
        .eq("category", category)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;

      let rows = data || [];

      // First-ever load with no goals → seed the starter suggestions once.
      const seedKey = `goals_seeded_${memberId}_${category}`;
      if (rows.length === 0 && !seededRef.current && !localStorage.getItem(seedKey)) {
        seededRef.current = true;
        const seedRows = SEED[category].map((label, i) => ({ member_id: memberId, category, label, position: i }));
        const { data: seeded, error: seedErr } = await supabase
          .from("member_goals")
          .insert(seedRows)
          .select("id, member_id, category, label, position");
        if (!seedErr && seeded) {
          localStorage.setItem(seedKey, "1"); // only mark seeded after it actually worked
          rows = seeded;
        } else {
          seededRef.current = false; // allow a retry on next load
          rows = [];
        }
      }
      setGoals(rows);

      // Which of these goals are checked *today* (their local date).
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const { data: comps, error: compErr } = await supabase
          .from("member_goal_completions")
          .select("goal_id")
          .eq("member_id", memberId)
          .eq("completed_on", day)
          .in("goal_id", ids);
        if (compErr) throw compErr;
        setDoneToday(new Set((comps || []).map((c) => c.goal_id)));
      } else {
        setDoneToday(new Set());
      }
      setToday(day);
    } catch (err: any) {
      console.error("Goals fetch error:", err);
      toast.error("Couldn't load goals.", { description: err?.message });
    } finally {
      setIsLoading(false);
    }
  }, [memberId, category]);

  useEffect(() => {
    fetchGoals();
    const channel = supabase
      .channel(`member-goals-${memberId}-${category}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_goals", filter: `member_id=eq.${memberId}` }, () => fetchGoals())
      .on("postgres_changes", { event: "*", schema: "public", table: "member_goal_completions", filter: `member_id=eq.${memberId}` }, () => fetchGoals())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchGoals, memberId, category]);

  // Midnight rollover: if the member leaves the dashboard open past their local
  // midnight, detect the date change and refetch so the list resets on its own.
  useEffect(() => {
    const tick = setInterval(() => {
      if (localToday() !== today) fetchGoals();
    }, 30_000);
    return () => clearInterval(tick);
  }, [today, fetchGoals]);

  const toggle = async (goal: Goal) => {
    const day = localToday();
    const wasDone = doneToday.has(goal.id);
    // optimistic
    setDoneToday((prev) => {
      const next = new Set(prev);
      if (wasDone) next.delete(goal.id); else next.add(goal.id);
      return next;
    });

    const { error } = wasDone
      ? await supabase
          .from("member_goal_completions")
          .delete()
          .eq("goal_id", goal.id)
          .eq("completed_on", day)
      : await supabase
          .from("member_goal_completions")
          .upsert({ goal_id: goal.id, member_id: memberId, completed_on: day }, { onConflict: "goal_id,completed_on" });

    if (error) {
      setDoneToday((prev) => {
        const next = new Set(prev);
        if (wasDone) next.add(goal.id); else next.delete(goal.id);
        return next;
      });
      toast.error("Couldn't update goal.");
    }
  };

  const addGoal = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setAdding(true);
    try {
      const { data, error } = await supabase
        .from("member_goals")
        .insert({ member_id: memberId, category, label, position: goals.length })
        .select("id, member_id, category, label, position")
        .single();
      if (error) throw error;
      setGoals((g) => [...g, data as Goal]);
      setNewLabel("");
    } catch (err: any) {
      toast.error("Couldn't add goal.", { description: err?.message });
    } finally {
      setAdding(false);
    }
  };

  const saveEdit = async (goal: Goal) => {
    const label = editLabel.trim();
    setEditingId(null);
    if (!label || label === goal.label) return;
    setGoals((g) => g.map((x) => (x.id === goal.id ? { ...x, label } : x))); // optimistic
    const { error } = await supabase.from("member_goals").update({ label, updated_at: new Date().toISOString() }).eq("id", goal.id);
    if (error) { toast.error("Couldn't rename goal."); fetchGoals(); }
  };

  const remove = async (goal: Goal) => {
    setGoals((g) => g.filter((x) => x.id !== goal.id)); // optimistic
    const { error } = await supabase.from("member_goals").delete().eq("id", goal.id);
    if (error) { toast.error("Couldn't delete goal."); fetchGoals(); }
  };

  // Icon + accent matched to the category so Diet / Exercise read as a pair.
  const CategoryIcon = category === "diet" ? Utensils : Dumbbell;
  const doneCount = goals.reduce((n, g) => n + (doneToday.has(g.id) ? 1 : 0), 0);

  return (
    <Card className="flex h-full flex-col border-white/10 bg-white/5 backdrop-blur-xl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 tracking-tight">
          <span className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow">
              <CategoryIcon className="h-5 w-5" />
            </span>
            {title}
          </span>
          {goals.length > 0 && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {doneCount}/{goals.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex grow flex-col gap-1.5">
        {isLoading ? (
          <PremiumSyncing label="Loading goals…" />
        ) : (
          <>
            {/* Scrollable goals list — capped so paired cards never grow asymmetrically. */}
            <div className="flex flex-col gap-1.5 overflow-y-auto custom-scrollbar -mr-2 pr-2 max-h-80">
            {goals.map((goal) => {
              const isDone = doneToday.has(goal.id);
              return (
              <div key={goal.id} className="group flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5">
                <Checkbox checked={isDone} onCheckedChange={() => toggle(goal)} />
                {editingId === goal.id ? (
                  <div className="flex flex-1 items-center gap-1">
                    <Input
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(goal); if (e.key === "Escape") setEditingId(null); }}
                      className="h-8 border-white/10 bg-white/5 text-sm backdrop-blur-xl"
                    />
                    <button onClick={() => saveEdit(goal)} className="text-emerald-500 hover:text-emerald-400" aria-label="Save"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground" aria-label="Cancel"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <>
                    <span className={cn("flex-1 text-sm font-medium leading-none", isDone && "text-muted-foreground line-through")}>{goal.label}</span>
                    <button
                      onClick={() => { setEditingId(goal.id); setEditLabel(goal.label); }}
                      className="text-muted-foreground opacity-0 transition-all hover:text-primary group-hover:opacity-100"
                      aria-label="Edit goal"
                    ><Pencil className="h-3.5 w-3.5" /></button>
                    <button
                      onClick={() => remove(goal)}
                      className="text-muted-foreground opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                      aria-label="Delete goal"
                    ><Trash2 className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
              );
            })}

            {goals.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No goals yet — add one below.</p>
            )}
            </div>

            {/* Add a new goal — pinned to the bottom so paired cards stay symmetric. */}
            <div className="mt-auto flex items-center gap-2 pt-3">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addGoal(); }}
                placeholder="Add a goal..."
                className="h-9 border-white/10 bg-white/5 text-sm backdrop-blur-xl"
              />
              <button
                onClick={addGoal}
                disabled={adding || !newLabel.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-white shadow-glow transition-all hover:shadow-primary/40 disabled:opacity-40 disabled:shadow-none"
                aria-label="Add goal"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
