"use client";

import {
  ArrowRight,
  Database,
  GitBranch,
  GraduationCap,
  History,
  Link2,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { GraphIllustration } from "@/components/graph-illustration";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { authRedirect, supabase } from "@/lib/supabase";

const FEATURES = [
  {
    icon: GitBranch,
    title: "Typed, directed links",
    description:
      "Say how ideas relate: supports, contradicts, prerequisite for. Not just folders and tags.",
  },
  {
    icon: Link2,
    title: "[[Wiki-links]] as you write",
    description:
      "Type [[ to link a note mid-sentence. A missing note is one Ctrl+click from existing.",
  },
  {
    icon: Search,
    title: "Search that ranks",
    description:
      "Full-text search with phrases and exclusions, highlighted matches, and typo tolerance.",
  },
  {
    icon: History,
    title: "Every version kept",
    description: "Edits are versioned automatically. Restore any earlier version in one click.",
  },
  {
    icon: GraduationCap,
    title: "Flashcards that schedule themselves",
    description: "Turn notes into cards; SM-2 spaced repetition decides when you see them again.",
  },
  {
    icon: Database,
    title: "Built on PostgreSQL",
    description:
      "Triggers, views, row level security and graph traversal run in the database itself.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [checkedSession, setCheckedSession] = useState(false);

  // Signed-in visitors skip the marketing page entirely. checkedSession
  // starts false so nothing renders until we know which case this is —
  // avoids flashing the hero at someone about to be redirected away.
  useEffect(() => {
    // Supabase sends a reset link here when /reset-password isn't on the
    // project's redirect allow-list. It still signs the user in, so without
    // this the link would land on the dashboard and never ask for a password.
    if (authRedirect.type === "recovery" || authRedirect.errorCode) {
      router.replace("/reset-password");
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace("/dashboard");
      } else {
        setCheckedSession(true);
      }
    });
  }, [router]);

  if (!checkedSession) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_75%_20%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent_70%)]"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
                <span aria-hidden className="size-1.5 rounded-full bg-primary" />A personal
                knowledge base
              </p>
              <h1 className="mt-6 text-4xl leading-[1.08] font-semibold tracking-[-0.035em] sm:text-[3.25rem]">
                Your notes, connected the way you think.
              </h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
                NeuroVault turns what you write into a graph of linked ideas. Explore what&rsquo;s
                nearby, find the path between two concepts, and review what matters.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" className="h-10 px-4" asChild>
                  <Link href="/signup">
                    Create your free account
                    <ArrowRight />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="h-10 px-4" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>
            </div>

            {/* A window frame around the illustration, so it reads as the product. */}
            <div className="rounded-2xl border bg-card/70 p-2 shadow-raised backdrop-blur">
              <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-2.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-2.5 rounded-full bg-muted-foreground/20" />
                ))}
                <span className="ml-3 truncate text-xs text-muted-foreground">
                  Normalization · graph
                </span>
              </div>
              <div className="rounded-xl border bg-background px-4 py-8 sm:px-8">
                <GraphIllustration className="mx-auto w-full" />
              </div>
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-medium tracking-[0.08em] text-primary uppercase">
                Features
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em]">
                More than folders and tags
              </h2>
              <p className="mt-3 text-muted-foreground">
                A third structure for your notes: links with meaning, that the database can
                traverse.
              </p>
            </div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="bg-card p-6">
                  <span className="flex size-8 items-center justify-center rounded-md border bg-background text-primary shadow-soft">
                    <f.icon className="size-4" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-16 sm:flex-row sm:items-center sm:px-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">
                Start building your graph.
              </h2>
              <p className="mt-1 text-muted-foreground">
                Free to use. Export everything, any time.
              </p>
            </div>
            <Button size="lg" className="h-10 px-4" asChild>
              <Link href="/signup">
                Get started
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Logo markClassName="size-5" className="text-foreground" />
          <p>A knowledge base where notes form a graph.</p>
        </div>
      </footer>
    </div>
  );
}
