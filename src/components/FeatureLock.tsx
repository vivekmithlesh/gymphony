import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from '@tanstack/react-router';
import { Crown, Lock, X, Sparkles, CheckCircle2, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/supabase';
import { useAuth } from '@/lib/auth-context';
import { handleStripeCheckout } from './StripeProvider';
import { initiatePhonePePayment, finalizeUpgrade as finalizePhonePeUpgrade } from '@/lib/phonepe';

interface FeatureLockProps {
  planType: string;
  featureName: string;
  children: React.ReactNode;
  className?: string;
  badgePosition?: 'top-right' | 'inline';
}

export const FeatureLock: React.FC<FeatureLockProps> = ({ 
  planType, 
  featureName, 
  children,
  className = "",
  badgePosition = 'top-right'
}) => {
  const navigate = useNavigate();
  const [showPricing, setShowPricing] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [currency, setCurrency] = React.useState<'INR' | 'USD'>('INR');
  const { user } = useAuth();

  const isPro = true; // planType === 'Pro'; // Temporarily disabled for customer demo

  const handleLockClick = (e: React.MouseEvent) => {
    if (!isPro) {
      e.preventDefault();
      e.stopPropagation();
      setShowPricing(true);
    }
  };

  const handlePhonePe = async () => {
    if (!user) return;

    await initiatePhonePePayment(
      1999,
      user.id,
      async () => {
        await finalizePhonePeUpgrade(user.id);
        setShowPricing(false);
        window.location.reload();
      },
      setIsProcessing
    );
  };

  const handleStripe = async () => {
    await handleStripeCheckout(featureName, finalizeUpgrade, setIsProcessing);
  };

  const finalizeUpgrade = async () => {
    try {
      if (!user) throw new Error("User not found");

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      
      const { error } = await supabase
        .from("gym_settings")
        .update({
          plan_type: "Pro",
          plan_status: "Active",
          expiry_date: thirtyDaysFromNow.toISOString()
        })
        .eq("gym_owner_id", user.id);

      if (error) throw error;
      
      toast.success("✅ Welcome to Pro! Features unlocked.");
      setShowPricing(false);
      window.location.reload(); 
    } catch (err: any) {
      toast.error("Update failed. Please contact support.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div 
        className={`relative group cursor-pointer ${className}`} 
        onClick={handleLockClick}
      >
        {!isPro && badgePosition === 'top-right' && (
          <div className="absolute -top-1 -right-1 z-20">
            <div className="bg-gradient-brand text-white p-1 rounded-lg shadow-lg">
              <Crown className="h-3 w-3" />
            </div>
          </div>
        )}
        
        <div className={!isPro ? "pointer-events-none opacity-60 grayscale-[0.5]" : ""}>
          {children}
        </div>

        {!isPro && (
          <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/10 rounded-xl">
             <div className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2 border border-primary/20">
               <Lock className="h-3 w-3 text-primary" />
               <span className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Unlock Pro</span>
             </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showPricing && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-white rounded-[3rem] overflow-hidden shadow-2xl relative border border-white/20"
            >
              <div className="absolute top-6 right-6">
                <button onClick={() => setShowPricing(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-2">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-10 space-y-8">
                <div className="text-center space-y-4">
                  <div className="h-20 w-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-2">
                    <Crown className="h-10 w-10 text-primary animate-pulse" />
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Pro Feature Locked</h2>
                  
                  {/* Currency selector hidden for now as per instructions, defaults to INR */}
                  <div className="hidden flex justify-center gap-2 mt-2">
                    <button onClick={() => setCurrency('INR')}>INR</button>
                    <button onClick={() => setCurrency('USD')}>USD</button>
                  </div>

                  <p className="text-slate-500 font-medium pt-2">
                    Upgrade to Pro to unlock <span className="text-primary font-bold">{featureName}</span> and other advanced business tools.
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
                    <span className="text-sm font-bold text-slate-700">Advanced AI Retention Bot</span>
                  </div>
                </div>

                <div className="space-y-4 pt-2">
                  <Button 
                    onClick={() => {
                      // Navigate to settings tab for upgrade
                      navigate({ 
                        to: '/dashboard', 
                        search: (prev: any) => ({ ...prev, tab: 'Settings', section: 'Billing & Plans' }) 
                      });
                      // Fallback for parent state
                      window.dispatchEvent(new CustomEvent('switchTab', { detail: 'Settings' }));
                      setShowPricing(false);
                    }}
                    className="w-full h-16 rounded-2xl bg-gradient-brand text-white font-bold text-lg shadow-glow hover:shadow-primary/40 transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles className="h-5 w-5" />
                    Upgrade Now • {currency === 'INR' ? '₹1,999' : '$25'}/mo
                  </Button>
                  <p className="text-center text-[10px] text-muted-foreground uppercase font-bold tracking-widest flex items-center justify-center gap-2">
                    <Globe className="h-3 w-3" />
                    Secure Payment Simulation
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
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);
