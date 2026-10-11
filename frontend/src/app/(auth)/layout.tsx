import { GitBranch, History, Search } from "lucide-react";
import Link from "next/link";

import { GraphIllustration } from "@/components/graph-illustration";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const POINTS = [
  { icon: GitBranch, text: "Typed links between notes, and [[wiki-links]] as you write" },
  { icon: History, text: "Every edit versioned, with one-click restore" },
  { icon: Search, text: "Ranked full-text search across everything" },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          {/* The auth pages are Cards; on this split layout the panel already frames
              them, so they render flat: no border, no inner padding. */}
          <div className="w-full max-w-sm [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:py-0 [&_[data-slot=card]]:shadow-none [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-description]]:text-sm [&_[data-slot=card-footer]]:border-0 [&_[data-slot=card-footer]]:bg-transparent [&_[data-slot=card-footer]]:px-0 [&_[data-slot=card-header]]:mb-2 [&_[data-slot=card-header]]:px-0 [&_[data-slot=card-title]]:text-2xl [&_[data-slot=card-title]]:font-semibold [&_[data-slot=card-title]]:tracking-[-0.025em]">
            {children}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Your notes stay private unless you choose to share them.
        </p>
      </div>

      {/* Brand panel: decorative context for the form, desktop only. */}
      <aside className="relative hidden overflow-hidden border-l bg-muted/40 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_30%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_70%)]"
        />
        <div className="relative">
          <p className="text-xs font-medium tracking-[0.08em] text-primary uppercase">
            Knowledge graph
          </p>
          <h2 className="mt-3 max-w-md text-3xl leading-tight font-semibold tracking-[-0.025em]">
            Notes that remember how ideas connect.
          </h2>
        </div>
        <GraphIllustration className="relative mx-auto my-8 w-full max-w-lg" />
        <ul className="relative space-y-3">
          {POINTS.map((p) => (
            <li key={p.text} className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-7 items-center justify-center rounded-md border bg-card text-foreground shadow-soft">
                <p.icon className="size-3.5" />
              </span>
              {p.text}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
