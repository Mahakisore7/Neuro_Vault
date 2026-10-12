"use client";

import { animate, motion, useInView, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";

// One easing curve and a few durations for the whole app, so motion feels
// like one hand made it. Entering decelerates; nothing bounces.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 0.8 } as const;

const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

/**
 * A group whose children rise in one after another. Use with <StaggerItem>.
 * `inView` waits until the group scrolls into view (landing page).
 */
export function Stagger({
  children,
  className,
  delay = 0,
  step = 0.05,
  inView = false,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  step?: number;
  inView?: boolean;
  as?: "div" | "ul" | "section";
}) {
  const Tag = motion[as];
  const reduce = useReducedMotion();
  return (
    <Tag
      className={className}
      initial={reduce ? false : "hidden"}
      {...(inView
        ? { whileInView: "show", viewport: { once: true, margin: "-60px" } }
        : { animate: "show" })}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
    >
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={rise}>
      {children}
    </Tag>
  );
}

/** Fades and lifts a single block in, once, when it appears (or scrolls into view). */
export function Reveal({
  children,
  className,
  delay = 0,
  inView = false,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  inView?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      {...(inView
        ? { whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" } }
        : { animate: { opacity: 1, y: 0 } })}
      transition={{ duration: 0.55, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A number that counts up to its value the first time it's seen. With reduced
 * motion, or for a changed value later, it just shows the number.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduce || !seen) return;
    const controls = animate(0, value, {
      duration: 0.9,
      ease: EASE_OUT,
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [seen, value, reduce]);

  return (
    <span ref={ref} className={className}>
      {new Intl.NumberFormat().format(reduce ? value : shown)}
    </span>
  );
}
