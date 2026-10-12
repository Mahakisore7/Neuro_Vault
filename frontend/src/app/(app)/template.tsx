"use client";

import { motion, useReducedMotion } from "motion/react";

import { EASE_OUT } from "@/components/motion";

// Unlike a layout, a template remounts on every navigation, so each page
// eases in (a short fade and a 6px rise) instead of snapping into place.
// The app shell around it, the sidebar and header, doesn't move.
export default function Template({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
