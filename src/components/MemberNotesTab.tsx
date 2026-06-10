import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/supabase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Loader2, Save, Trash2, NotebookPen } from 'lucide-react';
import { toast } from 'sonner';
import { format, parse } from 'date-fns';

interface MemberNote {
  id: string;
  member_id: string;
  note_date: string; // 'yyyy-MM-dd'
  note_content: string;
  created_at: string;
  updated_at: string;
}

// Local day key — avoids UTC drift by formatting in the user's own timezone.
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const keyToDate = (key: string) => parse(key, 'yyyy-MM-dd', new Date());

export function MemberNotesTab({ memberId }: { memberId: string }) {
  const [notesByDate, setNotesByDate] = useState<Record<string, MemberNote>>({});
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedKey = dayKey(selectedDate);
  const existingNote = notesByDate[selectedKey];

  // 1. Fetch all of this member's notes once and index them by day.
  useEffect(() => {
    const fetchNotes = async () => {
      if (!memberId) {
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('member_notes')
          .select('*')
          .eq('member_id', memberId)
          .order('note_date', { ascending: false });

        if (error) throw error;

        const map: Record<string, MemberNote> = {};
        (data || []).forEach((n: MemberNote) => { map[n.note_date] = n; });
        setNotesByDate(map);
      } catch (err: any) {
        console.error('Notes fetch error:', err);
        toast.error('Failed to fetch notes.', { description: err?.message });
      } finally {
        setIsLoading(false);
      }
    };

    fetchNotes();
  }, [memberId]);

  // 2. Whenever the selected date (or loaded notes) change, load that day's note
  //    into the editor.
  useEffect(() => {
    setDraft(notesByDate[selectedKey]?.note_content ?? '');
  }, [selectedKey, notesByDate]);

  // Dates that have a note — used to highlight them on the calendar.
  const datesWithNotes = useMemo(
    () => Object.keys(notesByDate).map(keyToDate),
    [notesByDate]
  );

  // 3. Insert or update the note for the selected day (one row per day).
  const handleSave = useCallback(async () => {
    if (!memberId) return;
    const content = draft.trim();
    if (!content) {
      toast.error('Write something before saving.');
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('member_notes')
        .upsert(
          {
            member_id: memberId,
            note_date: selectedKey,
            note_content: content,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'member_id,note_date' }
        )
        .select()
        .single();

      if (error) throw error;

      setNotesByDate(prev => ({ ...prev, [selectedKey]: data }));
      toast.success(existingNote ? 'Note updated!' : 'Note saved!');
    } catch (err: any) {
      console.error('Note save error:', err);
      toast.error('Failed to save note.', { description: err?.message });
    } finally {
      setIsSaving(false);
    }
  }, [memberId, draft, selectedKey, existingNote]);

  const handleDelete = useCallback(async () => {
    if (!existingNote) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('member_notes')
        .delete()
        .eq('id', existingNote.id);

      if (error) throw error;

      setNotesByDate(prev => {
        const next = { ...prev };
        delete next[selectedKey];
        return next;
      });
      setDraft('');
      toast.success('Note deleted.');
    } catch (err: any) {
      console.error('Note delete error:', err);
      toast.error('Failed to delete note.', { description: err?.message });
    } finally {
      setIsDeleting(false);
    }
  }, [existingNote, selectedKey]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  const isDirty = draft.trim() !== (existingNote?.note_content ?? '');

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
      {/* Calendar */}
      <Card className="w-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Journal calendar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(d) => d && setSelectedDate(d)}
            modifiers={{ hasNote: datesWithNotes }}
            modifiersClassNames={{
              hasNote: 'bg-indigo-100 text-indigo-700 font-semibold rounded-md',
            }}
            className="rounded-md"
          />
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-block h-3 w-3 rounded-sm bg-indigo-100 ring-1 ring-indigo-200" />
            Days with a note
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </CardTitle>
            <p className="mt-1 text-xs text-slate-400">
              {existingNote
                ? `Last updated ${format(new Date(existingNote.updated_at), "MMM d 'at' h:mm a")}`
                : 'No note yet for this day — write one below.'}
            </p>
          </div>
          {existingNote && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={isDeleting}
              title="Delete this day's note"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Log your progress, how the session felt, or plans for next time..."
            className="min-h-60 flex-1 resize-none text-sm leading-relaxed"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {isDirty ? 'Unsaved changes' : existingNote ? 'Saved' : ''}
            </span>
            <Button onClick={handleSave} disabled={isSaving || !isDirty || !draft.trim()}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {existingNote ? 'Update note' : 'Save note'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
