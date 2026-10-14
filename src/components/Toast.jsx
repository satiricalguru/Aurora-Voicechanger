import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

// Short confirmations ("Saved the last 30 s"), including ones triggered by
// global hotkeys while the window was in the background.
export default function Toast({ toast }) {
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    setShown(toast);
    const t = setTimeout(() => setShown(s => (s?.id === toast.id ? null : s)), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="toast-wrap" aria-live="polite">
      <AnimatePresence>
        {shown && (
          <motion.div key={shown.id} className="toast" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            <Check size={15} /> {shown.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
