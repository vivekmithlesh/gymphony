import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, Lock, X, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/supabase';
import { useAuth } from '@/lib/auth-context';
import { initiatePhonePePayment, finalizeUpgrade } from '@/lib/phonepe';

interface ProFeatureGuardProps {
  planType: string;
  featureName: string;
  children: React.ReactNode;
  onUpgradeSuccess?: () => void;
}

export const ProFeatureGuard: React.FC<ProFeatureGuardProps> = ({ 
  planType, 
  featureName, 
  children,
  onUpgradeSuccess 
}) => {
  const [showModal, setShowModal] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const { user } = useAuth();

  const isPro = planType === 'Pro';

  const handleProClick = (e: React.MouseEvent) => {
    if (!isPro) {
      e.preventDefault();
      e.stopPropagation();
      setShowModal(true);
    }
  };

  const handlePayment = async () => {
    if (!user) return;

    await initiatePhonePePayment(
      1999,
      user.id,
      async () => {
        await finalizeUpgrade(user.id);
        setShowModal(false);
        if (onUpgradeSuccess) onUpgradeSuccess();
        window.location.reload();
      },
      setIsProcessing
    );
  };

  return (
    <>
      <div className="relative group" onClick={handleProClick}>
        {!isPro && (
          <div className="absolute top-2 right-2 z-10">
            <div className="bg-amber-100 text-amber-700 p-1 rounded-lg shadow-sm">
              <Lock className="h-3 w-3" />
            </div>
          </div>
        )}
        <div className={!isPro ? "pointer-events-none opacity-80" : ""}>
          {children}
        </div>
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-white rounded-[2.5rem] overflow-hidden shadow-2xl relative"
            >
              <div className="absolute top-6 right-6">
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-2">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-10 space-y-8">
                <div className="text-center space-y-4">
                  <div className="h-20 w-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-2">
                    <Crown className="h-10 w-10 text-primary animate-pulse" />
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Upgrade to Pro</h2>
                  <p className="text-slate-500 font-medium">
                    Unlock <span className="text-primary font-bold">{featureName}</span> and scale your gym to the next level.
                  </p>
                </div>

                <div className="space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-bold text-slate-700">Unlimited Member Records</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-bold text-slate-700">Automated WhatsApp Reminders</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-bold text-slate-700">AI Retention Analytics</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-bold text-slate-700">Advanced Inventory Control</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <Button 
                    onClick={handlePayment}
                    disabled={isProcessing}
                    className="w-full h-14 rounded-2xl bg-gradient-brand text-white font-bold text-lg shadow-glow hover:shadow-primary/40 transition-all flex items-center justify-center gap-2"
                  >
                    {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                      <>
                        <Sparkles className="h-5 w-5" />
                        Upgrade Now • ₹1,999/mo
                      </>
                    )}
                  </Button>
                  <p className="text-center text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                    Secure Payment via Razorpay
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

const Loader2 = ({ className }: { className?: string }) => (
  <svg
    className={`animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);
