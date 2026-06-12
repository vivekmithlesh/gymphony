import React, { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Crown, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hasAccess } from '@/lib/permissions';
import { supabase } from '@/supabase';
import { useAuth } from '@/lib/auth-context';

interface ProtectedProRouteProps {
  featureName: string;
  description: string;
  children: React.ReactNode;
}

export const ProtectedProRoute: React.FC<ProtectedProRouteProps> = ({ 
  featureName, 
  description, 
  children 
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [planType, setPlanType] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPlan = async () => {
      if (user?.id) {
        const { data } = await supabase
          .from('gym_settings')
          .select('plan_type')
          .eq('gym_owner_id', user.id)
          .single();
        setPlanType(data?.plan_type || 'Free');
      }
      setIsLoading(false);
    };
    fetchPlan();
  }, [user?.id]);

  const isPro = hasAccess(planType, 'advanced_analytics');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isPro) {
    return <>{children}</>;
  }

  return (
    <div className="relative min-h-[500px] w-full">
      {/* Blurred Background Mockup */}
      <div className="absolute inset-0 blur-md grayscale opacity-40 pointer-events-none select-none">
        {children}
      </div>

      {/* Lock Overlay */}
      <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white/90 backdrop-blur-xl border border-white/20 shadow-2xl rounded-[3rem] p-10 text-center space-y-6"
        >
          <div className="h-20 w-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-2">
            <Crown className="h-10 w-10 text-primary animate-pulse" />
          </div>
          
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{featureName}</h2>
            <p className="text-slate-500 font-medium">
              {description}
            </p>
          </div>

          <div className="pt-4 space-y-4">
            <Button 
              onClick={() => {
                navigate({ 
                  to: '/dashboard', 
                  search: (prev: any) => ({ ...prev, tab: 'Settings', section: 'Billing & Plans' }) 
                });
                window.dispatchEvent(new CustomEvent('switchTab', { detail: 'Settings' }));
              }}
              className="w-full h-16 rounded-2xl bg-gradient-brand text-white font-bold text-xl shadow-glow hover:shadow-primary/40 transition-all flex items-center justify-center gap-2"
            >
              Upgrade to Pro
            </Button>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest flex items-center justify-center gap-2">
              <Lock className="h-3 w-3" />
              Unlock all premium features instantly
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
