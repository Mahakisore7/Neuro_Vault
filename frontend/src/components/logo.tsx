import { cn } from "@/lib/utils";

/**
 * The NeuroVault mark: three notes and the links between them, on an
 * indigo tile. One component so the sidebar, auth screens and landing page
 * can't drift apart.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[28%] bg-gradient-to-b from-primary to-[color-mix(in_oklch,var(--primary)_78%,black)] text-primary-foreground shadow-soft ring-1 ring-inset ring-white/15",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[72%]" fill="none">
        <path
          d="M6.5 8 17.5 6.5M6.5 8l5.5 10M17.5 6.5 12 18"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.55"
        />
        <circle cx="6.5" cy="8" r="2.6" fill="currentColor" />
        <circle cx="17.5" cy="6.5" r="2.2" fill="currentColor" />
        <circle cx="12" cy="18" r="3" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">NeuroVault</span>
    </span>
  );
}
