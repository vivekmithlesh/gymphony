import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Bot, Send } from 'lucide-react';
import { supabase } from '@/supabase';

interface ChatTurn {
  role: 'user' | 'ai';
  content: string;
}

interface MemberAIChatProps {
  gymId?: string | null;
  gymOwnerId?: string | null;
  memberName?: string | null;
  memberPhone?: string | null;
}

const GREETING = 'Hello! I am your Gymphony AI assistant. How can I help you today?';

export function MemberAIChat({ gymId, gymOwnerId, memberName, memberPhone }: MemberAIChatProps) {
  const [messages, setMessages] = useState<ChatTurn[]>([{ role: 'ai', content: GREETING }]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  // Auto-scroll to the newest message / typing indicator.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Track mount so an in-flight reply never sets state after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Lightweight keyword-based demo replies so the assistant feels responsive
  // before the real LLM is connected. (Swap this whole function for the
  // 'whatsapp-ai' Edge Function response later.)
  const getMockReply = (text: string): string => {
    const q = text.toLowerCase();

    if (/(plan|price|fee|cost|member|upgrade|pay)/.test(q))
      return 'You can see every membership plan and price in the "Available Plans" section, then tap "Upgrade / Pay Fees" to subscribe. Want help picking one?';
    if (/(time|timing|open|clos|hour|schedule)/.test(q))
      return 'Our opening hours are on the "Your Gym" card at the top of your dashboard — most days we\'re open early morning to late evening.';
    if (/(where|location|address|direction|reach|map)/.test(q))
      return 'You\'ll find the gym address and a "Directions" button on the "Your Gym" card at the top of your dashboard.';
    if (/(trainer|coach|personal)/.test(q))
      return 'Personal training is available! Share your preferred time and our team will arrange a trainer for you.';
    if (/(diet|nutrition|meal|protein|calorie)/.test(q))
      return 'Set your targets in "Diet Goals" and our coaches can tailor a plan. A balanced, high-protein diet with plenty of water is a great start!';
    if (/(workout|exercise|routine|train|split)/.test(q))
      return 'Log today\'s session in "Log a Workout". Tell me your goal — strength, weight loss, or endurance — and I\'ll suggest a starting routine.';
    if (/(hi|hello|hey|namaste)/.test(q))
      return 'Hey there! 👋 I can help with plans, timings, location, workouts and diet. What would you like to know?';
    if (/(thank|thanks|thx)/.test(q))
      return 'You\'re welcome! 💪 Anything else I can help you with?';

    return 'Thanks for your message! I can help with membership plans, gym timings, location, workouts and diet. (Demo assistant — full AI replies are coming soon.)';
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    // Show the member's message on the right immediately.
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsTyping(true);

    try {
      // Shared 'whatsapp-ai' Edge Function — app chats and WhatsApp chats use the
      // same LLM backend, and this message surfaces in the owner's inbox monitor.
      const replyPromise = supabase.functions.invoke('whatsapp-ai', {
        body: { message: text, gymId, gymOwnerId, memberName, memberPhone },
      });
      // Minimum typing time so the indicator doesn't flash on fast responses.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const { data, error } = await replyPromise;
      if (error) throw error;

      const reply = data?.paused
        ? 'Thanks! A team member will get back to you shortly.'
        : (data?.reply || getMockReply(text));

      if (mountedRef.current) {
        setMessages((prev) => [...prev, { role: 'ai', content: reply }]);
      }
    } catch (err) {
      // Edge function not deployed / unreachable — fall back to the local demo reply.
      console.warn('AI assistant unreachable, using demo reply:', err);
      if (mountedRef.current) {
        setMessages((prev) => [...prev, { role: 'ai', content: getMockReply(text) }]);
      }
    } finally {
      if (mountedRef.current) setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-lg">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-indigo-600 to-purple-600 text-white">
              <Bot className="h-4 w-4" />
            </span>
            AI Gym Assistant
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Online
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {/* Scrollable message history (grows to fill the card, min height keeps it usable) */}
        <div className="flex min-h-72 flex-1 flex-col gap-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
          {messages.map((m, i) => {
            const isUser = m.role === 'user';
            return (
              <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full bg-indigo-100 text-indigo-600">
                    <Bot className="h-4 w-4" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    isUser
                      ? 'rounded-br-sm bg-linear-to-br from-indigo-600 to-purple-600 text-white'
                      : 'rounded-bl-sm border border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            );
          })}

          {isTyping && (
            <div className="flex justify-start">
              <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full bg-indigo-100 text-indigo-600">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input + send */}
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about plans, timings, workouts…"
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            size="icon"
            className="shrink-0 bg-linear-to-br from-indigo-600 to-purple-600 text-white hover:opacity-90"
            title="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
