import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Send, Sparkles, Bot, User, Pause, Play, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/supabase';
import { useAuth } from '@/lib/auth-context';

interface GymSettings {
  id: string;
  gym_name?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  address?: string | null;
  description?: string | null;
}

interface GymPlan {
  id: string;
  name?: string | null;
  plan_name?: string | null;
  price?: number | null;
  duration?: number | null;
  duration_days?: number | null;
}

type Sender = 'member' | 'ai' | 'owner';

interface MessageRow {
  id: string;
  conversation_id: string | null;
  sender: Sender;
  content: string;
  created_at: string;
}

interface ConversationRow {
  id: string;
  gym_id: string | null;
  member_name: string | null;
  member_phone: string | null;
  ai_paused: boolean;
  last_message_at: string;
}

export default function WhatsAppBotWidget() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [gymSettings, setGymSettings] = useState<GymSettings | null>(null);
  const [gymPlans, setGymPlans] = useState<GymPlan[]>([]);
  const [gymId, setGymId] = useState<string | null>(null);
  const [gymOwnerId, setGymOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [isSimulatingInbound, setIsSimulatingInbound] = useState(false);

  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const getPlanSummary = () => {
    if (gymPlans.length === 0) return 'our current membership plans';
    return gymPlans
      .map((plan) => `${plan.name || plan.plan_name || 'Plan'} at ₹${(Number(plan.price) || 0).toLocaleString()}`)
      .join(', ');
  };

  // ---- data loading ---------------------------------------------------------
  const upsertConversation = (row: ConversationRow) => {
    setConversations((prev) => {
      const exists = prev.some((c) => c.id === row.id);
      const next = exists ? prev.map((c) => (c.id === row.id ? row : c)) : [...prev, row];
      return next.sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );
    });
  };

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      setIsLoading(true);
      try {
        const ownerId = user?.id || null;
        if (!ownerId || !isMounted) {
          setIsLoading(false);
          return;
        }
        setGymOwnerId(ownerId);

        const { data: settingsData } = await supabase
          .from('gym_settings')
          .select('id, gym_name, opening_time, closing_time, address, description')
          .eq('gym_owner_id', ownerId)
          .maybeSingle();
        if (!isMounted) return;

        const resolvedGymId = settingsData?.id || null;
        setGymId(resolvedGymId);
        setGymSettings(settingsData || null);

        if (resolvedGymId) {
          const [membershipPlans, gymPlansByGym, gymPlansByOwner] = await Promise.all([
            supabase.from('membership_plans').select('id, name, plan_name, price, duration').eq('gym_id', resolvedGymId),
            supabase.from('gym_plans').select('id, name, plan_name, price, duration, duration_days').eq('gym_id', resolvedGymId),
            supabase.from('gym_plans').select('id, name, plan_name, price, duration, duration_days').eq('gym_owner_id', ownerId),
          ]);
          if (!isMounted) return;

          const chosen =
            (membershipPlans.data && membershipPlans.data.length > 0) ? membershipPlans.data
              : (gymPlansByGym.data && gymPlansByGym.data.length > 0) ? gymPlansByGym.data
                : (gymPlansByOwner.data || []);
          setGymPlans(chosen as GymPlan[]);

          // Conversations + messages for this gym.
          const [{ data: convData }, { data: msgData }] = await Promise.all([
            supabase
              .from('conversations')
              .select('id, gym_id, member_name, member_phone, ai_paused, last_message_at')
              .eq('gym_id', resolvedGymId)
              .order('last_message_at', { ascending: false }),
            supabase
              .from('messages')
              .select('id, conversation_id, sender, content, created_at')
              .eq('gym_id', resolvedGymId)
              .order('created_at', { ascending: true })
              .limit(500),
          ]);
          if (!isMounted) return;

          setConversations((convData || []) as ConversationRow[]);
          setMessages((msgData || []) as MessageRow[]);
        }

        realtimeChannelRef.current = subscribeRealtime(resolvedGymId);
      } catch (error) {
        console.warn('Receptionist initialization failed:', error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    initialize();

    return () => {
      isMounted = false;
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribeRealtime = (resolvedGymId: string | null) => {
    const channel = supabase.channel('receptionist_inbox');
    const filter = resolvedGymId ? `gym_id=eq.${resolvedGymId}` : undefined;

    // New messages of any sender (member / ai / owner).
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', ...(filter ? { filter } : {}) },
      (payload) => {
        const row = payload.new as MessageRow;
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      }
    );

    // New threads + ai_paused toggles.
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'conversations', ...(filter ? { filter } : {}) },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldId = (payload.old as any)?.id;
          setConversations((prev) => prev.filter((c) => c.id !== oldId));
          return;
        }
        upsertConversation(payload.new as ConversationRow);
      }
    );

    return channel.subscribe();
  };

  // ---- derived state --------------------------------------------------------
  const turnsByConversation = useMemo(() => {
    const map = new Map<string, MessageRow[]>();
    [...messages]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .forEach((m) => {
        if (!m.conversation_id) return;
        const list = map.get(m.conversation_id) || [];
        list.push(m);
        map.set(m.conversation_id, list);
      });
    return map;
  }, [messages]);

  useEffect(() => {
    if (!selectedId && conversations.length > 0) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || conversations[0] || null,
    [conversations, selectedId]
  );
  const activeTurns = activeConversation ? turnsByConversation.get(activeConversation.id) || [] : [];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTurns.length, activeConversation?.id]);

  // ---- actions --------------------------------------------------------------
  const togglePause = async () => {
    if (!activeConversation) return;
    const next = !activeConversation.ai_paused;

    // Optimistic update; realtime will confirm.
    upsertConversation({ ...activeConversation, ai_paused: next });
    setPausingId(activeConversation.id);
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ ai_paused: next })
        .eq('id', activeConversation.id);
      if (error) throw error;
    } catch (err) {
      console.warn('Failed to update ai_paused:', err);
      upsertConversation({ ...activeConversation, ai_paused: !next }); // roll back
    } finally {
      setPausingId(null);
    }
  };

  // Owner manual reply — a human takeover message. Persists as sender:'owner'
  // and does NOT trigger the AI. (Delivering it to the member over WhatsApp is a
  // separate send concern, not the whatsapp-ai inbound→AI function.)
  const sendOwnerReply = async () => {
    const text = draft.trim();
    if (!text || !activeConversation || isSending) return;

    setIsSending(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([{
          conversation_id: activeConversation.id,
          gym_id: gymId,
          gym_owner_id: gymOwnerId,
          member_name: activeConversation.member_name,
          member_phone: activeConversation.member_phone,
          sender: 'owner',
          content: text,
        }])
        .select('id, conversation_id, sender, content, created_at')
        .single();

      if (error) throw error;

      if (data) {
        setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data as MessageRow]));
      }
      setDraft('');
    } catch (err) {
      console.warn('Failed to send owner reply:', err);
    } finally {
      setIsSending(false);
    }
  };

  // Inject an INBOUND member message to exercise the AI pipeline end-to-end.
  // Payload lines up exactly with the whatsapp-ai edge function schema; the
  // function inserts the sender:'member' row and (unless ai_paused) a sender:'ai'
  // row, both of which stream back in via realtime.
  const simulateInbound = async () => {
    if (!gymId || isSimulatingInbound) return;
    setIsSimulatingInbound(true);
    try {
      const { error } = await supabase.functions.invoke('whatsapp-ai', {
        body: {
          message: 'Hi! What are your membership plans and timings?',
          gymId,
          gymOwnerId,
          memberName: activeConversation?.member_name || 'Test Member',
          memberPhone: activeConversation?.member_phone || null,
        },
      });
      if (error) throw error;
      // New member + AI rows (and any new conversation) arrive via realtime.
      toast.success('Test message sent through the AI receptionist.');
    } catch (err) {
      console.warn('Simulate inbound failed (is whatsapp-ai deployed?):', err);
      toast.error('Could not reach the AI receptionist. Make sure the "whatsapp-ai" edge function is deployed.');
    } finally {
      setIsSimulatingInbound(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendOwnerReply();
    }
  };

  const nameOf = (c: ConversationRow) => c.member_name || c.member_phone || 'Member';

  // ---- render ---------------------------------------------------------------
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-purple-100 p-6 flex flex-col h-[600px] max-h-[600px] overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          🤖 AI WhatsApp Receptionist
        </h2>
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <span className="text-sm font-semibold text-green-600">Online</span>
        </div>
      </div>

      {/* Dynamic gym context (skeleton while loading). */}
      <div className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/40 px-4 py-3 text-xs text-purple-900">
        {isLoading ? (
          <div className="flex items-center gap-2">
            <div className="h-3 w-12 bg-purple-200/70 rounded animate-pulse" />
            <div className="h-3 w-28 bg-purple-200/50 rounded animate-pulse" />
            <div className="h-3 w-24 bg-purple-200/50 rounded animate-pulse" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">Context:</span>
            <span>{gymSettings?.gym_name || 'Gym'}</span>
            {gymSettings?.opening_time && gymSettings?.closing_time && (
              <span>• {gymSettings.opening_time} - {gymSettings.closing_time}</span>
            )}
            <span>• {gymPlans.length} membership plan{gymPlans.length === 1 ? '' : 's'} loaded</span>
          </div>
        )}
      </div>

      <div className="bg-gray-50 rounded-2xl border border-gray-100 font-sans text-sm grow overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Live Chat Monitor</p>
          <div className="flex items-center gap-2">
            {conversations.length > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {conversations.length} active
              </span>
            )}
            {gymId && (
              <button
                onClick={simulateInbound}
                disabled={isSimulatingInbound}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all disabled:opacity-50"
                title="Inject a test inbound member message through the AI"
              >
                {isSimulatingInbound ? <Loader2 className="h-3 w-3 animate-spin" /> : <Inbox className="h-3 w-3" />}
                Test inbound
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="grow flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
            <p className="text-xs text-muted-foreground">Connecting to WhatsApp inbox...</p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="grow flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
              <Sparkles className="h-6 w-6 text-purple-400" />
            </div>
            <p className="text-sm text-gray-500 font-medium">No active conversations</p>
            <p className="text-[11px] text-gray-400 mt-1 max-w-55">
              Member WhatsApp chats handled by the AI will appear here for you to monitor and step in.
            </p>
            {gymId && (
              <button
                onClick={simulateInbound}
                disabled={isSimulatingInbound}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-700 bg-purple-50 hover:bg-purple-100 px-4 py-2 rounded-xl transition-all disabled:opacity-50"
              >
                {isSimulatingInbound ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Inbox className="h-3.5 w-3.5" />}
                {isSimulatingInbound ? 'Sending…' : 'Simulate an inbound message'}
              </button>
            )}
          </div>
        ) : (
          <div className="grow flex flex-col overflow-hidden">
            {/* Active chats selector */}
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 custom-scrollbar shrink-0">
              {conversations.map((conv) => {
                const selected = conv.id === activeConversation?.id;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border shrink-0 transition-all ${
                      selected
                        ? 'bg-purple-600 border-purple-600 text-white shadow-sm'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-purple-200'
                    }`}
                  >
                    <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      selected ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-600'
                    }`}>
                      {nameOf(conv).charAt(0).toUpperCase()}
                    </span>
                    <span className="text-xs font-bold whitespace-nowrap max-w-24 truncate">{nameOf(conv)}</span>
                    {conv.ai_paused && (
                      <span className={`text-[8px] font-bold uppercase ${selected ? 'text-amber-200' : 'text-amber-500'}`}>
                        manual
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Conversation header + Human Takeover toggle */}
            <div className="flex items-center justify-between px-4 py-2 border-y border-gray-100 bg-white/60 shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{activeConversation && nameOf(activeConversation)}</p>
                {activeConversation?.member_phone && (
                  <p className="text-[10px] text-gray-400">{activeConversation.member_phone}</p>
                )}
              </div>
              <button
                onClick={togglePause}
                disabled={!activeConversation || pausingId === activeConversation?.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 disabled:opacity-60 ${
                  activeConversation?.ai_paused
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                }`}
                title={activeConversation?.ai_paused ? 'Resume automated AI replies' : 'Pause AI and reply manually'}
              >
                {pausingId === activeConversation?.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : activeConversation?.ai_paused ? (
                  <Play className="h-3 w-3" />
                ) : (
                  <Pause className="h-3 w-3" />
                )}
                {activeConversation?.ai_paused ? 'Resume AI' : 'Pause AI / Manual Reply'}
              </button>
            </div>

            {/* Chat history — sender drives the bubble style */}
            <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar space-y-3">
              <AnimatePresence initial={false}>
                {activeTurns.map((turn) => {
                  const isMember = turn.sender === 'member';
                  return (
                    <motion.div
                      key={turn.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${isMember ? 'justify-start' : 'justify-end'}`}
                    >
                      {isMember && (
                        <div className="h-7 w-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 mr-2 shrink-0 self-end">
                          <User className="h-4 w-4" />
                        </div>
                      )}
                      <div className="max-w-[80%]">
                        {turn.sender === 'ai' && (
                          <div className="flex items-center justify-end gap-1 mb-1">
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                              <Bot className="h-2.5 w-2.5" /> AI
                            </span>
                          </div>
                        )}
                        {turn.sender === 'owner' && (
                          <div className="flex items-center justify-end gap-1 mb-1">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-purple-500">You</span>
                          </div>
                        )}
                        <div
                          className={`p-3 shadow-sm text-left ${
                            turn.sender === 'member'
                              ? 'bg-white text-gray-800 border border-gray-200 rounded-tr-xl rounded-br-xl rounded-bl-xl'
                              : turn.sender === 'ai'
                                ? 'bg-green-500 text-white rounded-tl-xl rounded-bl-xl rounded-br-xl'
                                : 'bg-purple-600 text-white rounded-tl-xl rounded-bl-xl rounded-br-xl'
                          }`}
                        >
                          {turn.content}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={chatEndRef} />
            </div>

            {/* Owner intervention input */}
            <div className="px-4 py-3 border-t border-gray-100 bg-white shrink-0">
              {activeConversation?.ai_paused && (
                <p className="text-[10px] font-bold text-amber-600 mb-1.5 flex items-center gap-1">
                  <Pause className="h-2.5 w-2.5" /> AI paused — your replies go straight to the member.
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    activeConversation
                      ? activeConversation.ai_paused
                        ? `Reply to ${nameOf(activeConversation)} as the gym…`
                        : `Step in and reply to ${nameOf(activeConversation)}…`
                      : 'Select a conversation to reply…'
                  }
                  disabled={!activeConversation || isSending}
                  className="flex-1 h-11 px-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-300 transition-all disabled:opacity-50"
                />
                <button
                  onClick={sendOwnerReply}
                  disabled={!draft.trim() || !activeConversation || isSending}
                  className="h-11 w-11 flex items-center justify-center rounded-xl bg-purple-600 text-white hover:bg-purple-700 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  title="Send manual reply"
                >
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
