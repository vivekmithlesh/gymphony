import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { supabase } from "@/supabase";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Check, X, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

type Category = "diet" | "exercise";

interface Goal {
  id: string;
  member_id: string;
  category: Category;
  label: string;
  is_done: boolean;
  position: number;
}

// Suggested starter goals seeded once per member/category (they can edit/delete).
const SEED: Record<Category, string[]> = {
  diet: ["Hit 120g protein", "Drink 3L water", "Keep the post-workout meal clean"],
  exercise: ["20 minutes cardio", "Complete the strength block", "Finish mobility and stretching"],
};

export function MemberGoalsCard({ memberId, category, title }: { memberId: string; category: Category; title: string }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const seededRef = useRef(false);

  const fetchGoals = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("member_goals")
        .select("id, member_id, category, label, is_done, position")
        .eq("member_id", memberId)
        .eq("category", category)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;

      // First-ever load with no goals → seed the starter suggestions once.
      const seedKey = `goals_seeded_${memberId}_${category}`;
      if ((data || []).length === 0 && !seededRef.current && !localStorage.getItem(seedKey)) {
        seededRef.current = true;
        const rows = SEED[category].map((label, i) => ({ member_id: memberId, category, label, position: i }));
        const { data: seeded, error: seedErr } = await supabase
          .from("member_goals")
          .insert(rows)
          .select("id, member_id, category, label, is_done, position");
        if (!seedErr && seeded) {
          localStorage.setItem(seedKey, "1"); // only mark seeded after it actually worked
          setGoals(seeded);
        } else {
          seededRef.current = false; // allow a retry on next load
          setGoals([]);
        }
      } else {
        setGoals(data || []);
      }
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchGoals, memberId, category]);

  const toggle = async (goal: Goal) => {
    const next = !goal.is_done;
    setGoals((g) => g.map((x) => (x.id === goal.id ? { ...x, is_done: next } : x))); // optimistic
    const { error } = await supabase.from("member_goals").update({ is_done: next, updated_at: new Date().toISOString() }).eq("id", goal.id);
    if (error) {
      setGoals((g) => g.map((x) => (x.id === goal.id ? { ...x, is_done: !next } : x)));
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
        .select("id, member_id, category, label, is_done, position")
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

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-indigo-500" /></div>
        ) : (
          <>
            {goals.map((goal) => (
              <div key={goal.id} className="group flex items-center gap-2">
                <Checkbox checked={goal.is_done} onCheckedChange={() => toggle(goal)} />
                {editingId === goal.id ? (
                  <div className="flex flex-1 items-center gap-1">
                    <Input
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(goal); if (e.key === "Escape") setEditingId(null); }}
                      className="h-8 text-sm"
                    />
                    <button onClick={() => saveEdit(goal)} className="text-emerald-600 hover:text-emerald-700" aria-label="Save"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600" aria-label="Cancel"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <>
                    <span className={cn("flex-1 text-sm font-medium leading-none", goal.is_done && "text-slate-400 line-through")}>{goal.label}</span>
                    <button
                      onClick={() => { setEditingId(goal.id); setEditLabel(goal.label); }}
                      className="text-slate-300 opacity-0 transition-opacity hover:text-indigo-500 group-hover:opacity-100"
                      aria-label="Edit goal"
                    ><Pencil className="h-3.5 w-3.5" /></button>
                    <button
                      onClick={() => remove(goal)}
                      className="text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                      aria-label="Delete goal"
                    ><Trash2 className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
            ))}

            {goals.length === 0 && (
              <p className="py-1 text-sm text-slate-400">No goals yet — add one below.</p>
            )}

            {/* Add a new goal */}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addGoal(); }}
                placeholder="Add a goal..."
                className="h-9 text-sm"
              />
              <button
                onClick={addGoal}
                disabled={adding || !newLabel.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
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
