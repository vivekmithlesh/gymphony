import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, WifiOff } from "lucide-react";

/**
 * Global connectivity banner. Shows when the browser goes offline and, on
 * reconnect, refetches active queries so stale screens recover automatically.
 * SSR-safe: assumes online during render, reconciles in an effect on mount.
 */
export function OfflineBanner() {
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(false);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      setJustReconnected(false);
    };

    const handleOnline = () => {
      setIsOffline(false);
      setJustReconnected(true);
      void queryClient.refetchQueries({ type: "active" });
      window.setTimeout(() => setJustReconnected(false), 2500);
    };

    // Reconcile initial state (navigator is unavailable during SSR).
    setIsOffline(!navigator.onLine);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [queryClient]);

  return (
    <AnimatePresence>
      {(isOffline || justReconnected) && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="fixed inset-x-0 top-0 z-[100] flex justify-center"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
          role="status"
          aria-live="polite"
        >
          <div
            className={`mt-3 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur-xl ${
              isOffline ? "bg-red-500/90 text-white" : "bg-emerald-500/90 text-white"
            }`}
          >
            {isOffline ? (
              <>
                <WifiOff className="h-4 w-4" />
                You&apos;re offline — changes will retry when you reconnect.
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Back online — refreshing…
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
