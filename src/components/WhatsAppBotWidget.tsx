import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/supabase';

interface ReceptionistMessage {
  id: string;
  member_name?: string | null;
  full_name?: string | null;
  sender_name?: string | null;
  message?: string | null;
  content?: string | null;
  body?: string | null;
  text?: string | null;
  response?: string | null;
  reply?: string | null;
  answer?: string | null;
  created_at: string;
  gym_id?: string | null;
  gym_owner_id?: string | null;
  [key: string]: any;
}

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

export default function WhatsAppBotWidget() {
  const [messages, setMessages] = useState<ReceptionistMessage[]>([]);
  const [gymSettings, setGymSettings] = useState<GymSettings | null>(null);
  const [gymPlans, setGymPlans] = useState<GymPlan[]>([]);
  const [gymId, setGymId] = useState<string | null>(null);
  const [gymOwnerId, setGymOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);

  const fetchControllerRef = useRef<AbortController | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const getDisplayName = (row: ReceptionistMessage) => row.member_name || row.full_name || row.sender_name || 'Member';

  const getMessageText = (row: ReceptionistMessage) => row.message || row.content || row.body || row.text || 'New message';

  const getPlanSummary = () => {
    if (gymPlans.length === 0) {
      return 'our current membership plans';
    }

    return gymPlans
      .map((plan) => {
        const planName = plan.name || plan.plan_name || 'Plan';
        const price = Number(plan.price) || 0;
        return `${planName} at ₹${price.toLocaleString()}`;
      })
      .join(', ');
  };

  const buildContextAwareResponse = (messageText: string) => {
    const lowerMessage = messageText.toLowerCase();
    const gymName = gymSettings?.gym_name || 'the gym';
    const openingTime = gymSettings?.opening_time || '6:00 AM';
    const closingTime = gymSettings?.closing_time || '10:00 PM';

    if (lowerMessage.includes('price') || lowerMessage.includes('fee') || lowerMessage.includes('cost') || lowerMessage.includes('membership') || lowerMessage.includes('plan')) {
      return `Hi! ${gymName} currently offers ${getPlanSummary()}. Let me know which plan you want and I will share the details.`;
    }

    if (lowerMessage.includes('time') || lowerMessage.includes('timing') || lowerMessage.includes('open') || lowerMessage.includes('close') || lowerMessage.includes('hours')) {
      return `Hi! ${gymName} is open from ${openingTime} to ${closingTime}. Feel free to visit anytime during those hours.`;
    }

    if (lowerMessage.includes('address') || lowerMessage.includes('location') || lowerMessage.includes('where')) {
      return gymSettings?.address
        ? `Sure, ${gymName} is located at ${gymSettings.address}.`
        : `Sure, I can help with the location details for ${gymName}.`;
    }

    if (lowerMessage.includes('guest') || lowerMessage.includes('trial')) {
      return 'Yes, guest visits and trial entries can be arranged. Please share the preferred visit time and I will help with the rest.';
    }

    if (gymSettings?.description) {
      return `Thanks for reaching out. ${gymSettings.description}`;
    }

    return `Thanks for your message. The team at ${gymName} will get back to you shortly.`;
  };

  const normalizeMessage = (row: ReceptionistMessage): ReceptionistMessage => {
    const messageText = getMessageText(row);
    return {
      ...row,
      member_name: getDisplayName(row),
      message: messageText,
      response: row.response || row.reply || row.answer || buildContextAwareResponse(messageText),
    };
  };

  const fetchLatestChats = async (resolvedGymId?: string | null, resolvedOwnerId?: string | null) => {
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }

    fetchControllerRef.current = new AbortController();
    setIsLoading(true);

    try {
      let query = supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)
        .abortSignal(fetchControllerRef.current.signal);

      if (resolvedGymId) {
        query = query.eq('gym_id', resolvedGymId);
      } else if (resolvedOwnerId) {
        query = query.eq('gym_owner_id', resolvedOwnerId);
      }

      const { data, error } = await query;

      if (error) {
        if (error.name === 'AbortError' || error.message?.includes('abort') || error.message?.includes('Lock broken')) {
          return;
        }
        console.warn('Messages fetch error:', error.message);
        return;
      }

      setMessages((data || []).map((row: ReceptionistMessage) => normalizeMessage(row)));
    } catch (error: any) {
      if (error.name !== 'AbortError' && !error.message?.includes('abort') && !error.message?.includes('Lock broken')) {
        console.warn('Error fetching messages:', error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const subscribeToMessages = (resolvedGymId?: string | null, resolvedOwnerId?: string | null) => {
    const channel = supabase.channel('messages_realtime');
    const filter = resolvedGymId
      ? `gym_id=eq.${resolvedGymId}`
      : resolvedOwnerId
        ? `gym_owner_id=eq.${resolvedOwnerId}`
        : undefined;

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        ...(filter ? { filter } : {})
      },
      (payload) => {
        const normalized = normalizeMessage(payload.new as ReceptionistMessage);
        setMessages((prev) => [normalized, ...prev].slice(0, 5));
      }
    );

    return channel.subscribe();
  };

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      setIsLoading(true);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const ownerId = sessionData.session?.user?.id || null;

        if (!ownerId || !isMounted) {
          setMessages([]);
          setIsLoading(false);
          return;
        }

        setGymOwnerId(ownerId);

        const { data: settingsData, error: settingsError } = await supabase
          .from('gym_settings')
          .select('id, gym_name, opening_time, closing_time, address, description')
          .eq('gym_owner_id', ownerId)
          .maybeSingle();

        if (settingsError) {
          console.warn('Receptionist settings fetch error:', settingsError.message);
        }

        if (!isMounted) return;

        const resolvedGymId = settingsData?.id || null;
        setGymId(resolvedGymId);
        setGymSettings(settingsData || null);

        if (resolvedGymId) {
          const [gymPlansResult, ownerPlansResult] = await Promise.all([
            supabase
              .from('gym_plans')
              .select('id, name, plan_name, price, duration, duration_days')
              .eq('gym_id', resolvedGymId),
            supabase
              .from('gym_plans')
              .select('id, name, plan_name, price, duration, duration_days')
              .eq('gym_owner_id', ownerId),
          ]);

          if (!isMounted) return;

          const chosenPlans = (gymPlansResult.data && gymPlansResult.data.length > 0)
            ? gymPlansResult.data
            : (ownerPlansResult.data || []);

          if (gymPlansResult.error) {
            console.warn('Receptionist plans fetch error:', gymPlansResult.error.message);
          }

          setGymPlans(chosenPlans);
        } else {
          setGymPlans([]);
        }

        await fetchLatestChats(resolvedGymId, ownerId);
        if (!isMounted) return;

        realtimeChannelRef.current = subscribeToMessages(resolvedGymId, ownerId);
      } catch (error) {
        console.warn('Receptionist initialization failed:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      isMounted = false;
      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort();
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, []);

  const simulateMessage = async () => {
    setIsSimulating(true);

    try {
      const simulatedPrompt = 'What are the gym timings for tomorrow?';
      const simulatedResponse = buildContextAwareResponse(simulatedPrompt);

      const { error } = await supabase
        .from('messages')
        .insert([
          {
            member_name: 'Member',
            message: simulatedPrompt,
            response: simulatedResponse,
            gym_id: gymId,
            gym_owner_id: gymOwnerId,
            created_at: new Date().toISOString(),
          },
        ]);

      if (error) throw error;
      toast.success('New message simulated!');
    } catch (error: any) {
      console.warn('Simulation failed:', error.message);
      toast.error('Unable to simulate message');
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-purple-100 p-6 flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          🤖 AI WhatsApp Receptionist
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={simulateMessage}
            disabled={isSimulating}
            className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            {isSimulating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Simulate
          </button>
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-sm font-semibold text-green-600">Online</span>
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/40 px-4 py-3 text-xs text-purple-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">Context:</span>
          <span>{gymSettings?.gym_name || 'Gym'}</span>
          {gymSettings?.opening_time && gymSettings?.closing_time && (
            <span>• {gymSettings.opening_time} - {gymSettings.closing_time}</span>
          )}
          <span>• {gymPlans.length} membership plan{gymPlans.length === 1 ? '' : 's'} loaded</span>
        </div>
      </div>

      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 font-sans text-sm grow overflow-hidden flex flex-col">
        <p className="text-xs text-gray-400 mb-3 uppercase font-bold tracking-wider">Live Chat Feed</p>

        {isLoading ? (
          <div className="grow flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
            <p className="text-xs text-muted-foreground">Connecting to WhatsApp feed...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="grow flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
              <Sparkles className="h-6 w-6 text-purple-400" />
            </div>
            <p className="text-sm text-gray-500 font-medium">No messages yet</p>
            <p className="text-[11px] text-gray-400 mt-1 max-w-45">AI Receptionist is ready to handle member inquiries with live gym data.</p>
          </div>
        ) : (
          <div className="space-y-6 overflow-y-auto pr-1 custom-scrollbar">
            <AnimatePresence initial={false}>
              {messages.map((chat) => (
                <motion.div
                  key={chat.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="space-y-3"
                >
                  <div className="flex flex-col items-start">
                    <p className="text-[11px] text-gray-500 font-bold mb-1 ml-1">Member ({chat.member_name || 'Member'}):</p>
                    <div className="bg-white p-3 rounded-tr-xl rounded-br-xl rounded-bl-xl border border-gray-200 shadow-sm max-w-[85%] text-gray-800">
                      {chat.message || 'New message'}
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <p className="text-[11px] text-purple-600 font-bold mb-1 mr-1">Gymphony AI:</p>
                    <div className="bg-purple-600 text-white p-3 rounded-tl-xl rounded-bl-xl rounded-br-xl shadow-sm max-w-[85%] text-left">
                      {chat.response || buildContextAwareResponse(chat.message || '')}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
