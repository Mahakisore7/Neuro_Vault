"use client";

import {
  ArrowRight,
  Compass,
  Database,
  GitBranch,
  GraduationCap,
  History,
  Link2,
  PenLine,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { GraphIllustration } from "@/components/graph-illustration";
import { Logo } from "@/components/logo";
import {
  FlashcardPreview,
  LinkTypesPreview,
  SearchPreview,
  SqlPreview,
  VersionsPreview,
  WikiLinkPreview,
} from "@/components/marketing-previews";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { authRedirect, supabase } from "@/lib/supabase";

const TILES = [
  {
    icon: GitBranch,
    title: "Typed, directed links",
    description:
      "Say how ideas relate: supports, contradicts, prerequisite for. Folders and tags can't.",
    preview: <LinkTypesPreview />,
    span: "lg:col-span-2",
  },
  {
    icon: Link2,
    title: "[[Wiki-links]] as you write",
    description:
      "Type [[ to link a note mid-sentence. A missing note is one Ctrl+click from existing.",
    preview: <WikiLinkPreview />,
    span: "",
  },
  {
    icon: Search,
    title: "Search that ranks",
    description: "Phrases, exclusions, highlighted matches, and a fallback for typos.",
    preview: <SearchPreview />,
    span: "",
  },
  {
    icon: History,
    title: "Every version kept",
    description: "Edits are versioned automatically. Restore any earlier one in a click.",
    preview: <VersionsPreview />,
    span: "",
  },
  {
    icon: GraduationCap,
    title: "Flashcards that schedule themselves",
    description: "Turn any note into cards; spaced repetition decides when you see them again.",
    preview: <FlashcardPreview />,
    span: "",
  },
  {
    icon: Database,
    title: "Built on PostgreSQL",
    description:
      "Triggers, views, row level security and graph traversal run in the database itself.",
    preview: <SqlPreview />,
    span: "lg:col-span-3",
  },
];

const STEPS = [
  {
    icon: PenLine,
    title: "Write",
    text: "Capture a note in a distraction-free editor. It saves as you type, and every edit is kept.",
  },
  {
    icon: Link2,
    title: "Connect",
    text: "Link it to what it builds on, contradicts or supports, by hand or with [[wiki-links]].",
  },
  {
    icon: Compass,
    title: "Explore",
    text: "See what's within a few hops, find the path between two ideas, review what matters.",
  },
];

const FACTS = [
  { value: "15", label: "tables, all tenancy-checked by the database" },
  { value: "209", label: "automated tests, on a real database" },
  { value: "AA", label: "WCAG 2.1 contrast, in light and dark" },
  { value: "1", label: "click to export everything you wrote" },
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
      <header className="sticky top-0 z-30 border-b border-transparent bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/70">
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
          {/* Two soft washes of the accent behind the hero, nothing more. */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[radial-gradient(45%_55%_at_80%_15%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_70%),radial-gradient(35%_45%_at_10%_90%,color-mix(in_oklch,var(--primary)_6%,transparent),transparent_70%)]"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.1fr]">
            <Stagger step={0.08} delay={0.05}>
              <StaggerItem>
                <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
                  <span
                    aria-hidden
                    className="size-1.5 animate-pulse-soft rounded-full bg-primary"
                  />
                  A personal knowledge base
                </p>
              </StaggerItem>
              <StaggerItem>
                <h1 className="mt-6 text-4xl leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[3.5rem]">
                  Your notes,{" "}
                  <span className="bg-linear-to-r from-primary to-[color-mix(in_oklch,var(--primary)_55%,#c026d3)] bg-clip-text text-transparent">
                    connected
                  </span>{" "}
                  the way you think.
                </h1>
              </StaggerItem>
              <StaggerItem>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
                  NeuroVault turns what you write into a graph of linked ideas. See what&rsquo;s
                  nearby, find the path between two concepts, and review what matters.
                </p>
              </StaggerItem>
              <StaggerItem>
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
              </StaggerItem>
              <StaggerItem>
                <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5" />
                    Private by default
                  </span>
                  <span>Export everything, any time</span>
                  <span>Light and dark</span>
                </p>
              </StaggerItem>
            </Stagger>

            {/* The graph in a window frame, so it reads as the product, with a
                small "typing a wiki-link" card floating over its corner. */}
            <Reveal delay={0.2} className="relative">
              <div className="rounded-2xl border bg-card/70 p-2 shadow-floating backdrop-blur">
                <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-2.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-2.5 rounded-full bg-muted-foreground/20" />
                  ))}
                  <span className="ml-3 truncate text-xs text-muted-foreground">
                    Normalization · graph
                  </span>
                </div>
                <div className="rounded-xl border bg-background px-4 pt-8 pb-16 sm:px-8">
                  <GraphIllustration className="mx-auto w-full" />
                </div>
              </div>
              <div className="absolute -bottom-6 -left-4 hidden w-64 sm:block">
                <WikiLinkPreview />
              </div>
            </Reveal>
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <Reveal inView className="max-w-2xl">
              <p className="text-xs font-medium tracking-[0.08em] text-primary uppercase">
                What you get
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                More than folders and tags
              </h2>
              <p className="mt-3 text-muted-foreground">
                A third structure for your notes: links with meaning that the database can traverse.
                Everything around it is built to stay out of your way.
              </p>
            </Reveal>

            <Stagger inView step={0.07} className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TILES.map((t) => (
                <StaggerItem key={t.title} className={t.span}>
                  <div
                    className={`group flex h-full flex-col rounded-2xl border bg-card p-5 shadow-soft transition-[border-color,box-shadow] duration-300 hover:border-primary/30 hover:shadow-raised ${
                      t.span ? "lg:flex-row lg:items-center lg:gap-10" : ""
                    }`}
                  >
                    <div className={`mb-5 flex-1 ${t.span ? "lg:mb-0" : ""}`}>{t.preview}</div>
                    <div className={t.span ? "lg:w-2/5 lg:shrink-0" : ""}>
                      <span className="flex size-8 items-center justify-center rounded-md border bg-background text-primary shadow-soft">
                        <t.icon className="size-4" />
                      </span>
                      <h3 className="mt-3 text-sm font-semibold">{t.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {t.description}
                      </p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <Reveal inView className="max-w-2xl">
              <p className="text-xs font-medium tracking-[0.08em] text-primary uppercase">
                How it works
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Write, connect, explore
              </h2>
            </Reveal>
            <Stagger inView step={0.1} className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <StaggerItem key={s.title}>
                  <div className="relative">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 ring-inset">
                        <s.icon className="size-5" />
                      </span>
                      {i < STEPS.length - 1 && (
                        <span
                          aria-hidden
                          className="hidden h-px flex-1 bg-linear-to-r from-border to-transparent md:block"
                        />
                      )}
                    </div>
                    <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em]">{s.title}</h3>
                    <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
                      {s.text}
                    </p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <Stagger
            inView
            step={0.08}
            className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4"
          >
            {FACTS.map((f) => (
              <StaggerItem key={f.label}>
                <p className="text-4xl font-semibold tracking-[-0.04em] tabular-nums">{f.value}</p>
                <p className="mt-1 max-w-[16rem] text-sm text-muted-foreground">{f.label}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <section>
          <Reveal
            inView
            className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-20 sm:flex-row sm:items-center sm:px-6"
          >
            <div>
              <h2 className="text-3xl font-semibold tracking-[-0.03em]">
                Start building your graph.
              </h2>
              <p className="mt-2 text-muted-foreground">
                Free to use. Your notes are yours: export them whenever you like.
              </p>
            </div>
            <Button size="lg" className="h-10 px-4" asChild>
              <Link href="/signup">
                Get started
                <ArrowRight />
              </Link>
            </Button>
          </Reveal>
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
