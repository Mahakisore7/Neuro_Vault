"use client";

import { GitBranch, History, Network as NetworkIcon, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { authRedirect, supabase } from "@/lib/supabase";

const FEATURES = [
  {
    icon: NetworkIcon,
    title: "Notes that link together",
    description: "Connect ideas across notebooks with typed, directed edges — not just folders and tags.",
  },
  {
    icon: History,
    title: "Full version history",
    description: "Every edit is saved automatically. Roll back to any earlier version, any time.",
  },
  {
    icon: Search,
    title: "Organized your way",
    description: "Workspaces, notebooks, and notes — a structure that scales from a single idea to a whole field of study.",
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
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <NetworkIcon className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">NeuroVault</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="relative mx-auto max-w-6xl overflow-hidden px-6 py-20 sm:py-28">
        <GraphBackdrop />
        <div className="relative mx-auto max-w-2xl text-center">
          <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            <GitBranch className="size-3" />
            A personal knowledge base
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Your notes, as a <span className="text-primary">graph</span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground text-balance">
            NeuroVault organizes what you write into workspaces and notebooks, then lets
            you connect ideas across them — so your knowledge stays as linked as your
            thinking.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">Create your workspace</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-4.5" />
              </div>
              <h3 className="mb-1.5 font-medium">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        NeuroVault — a personal knowledge base where notes form a graph.
      </footer>
    </div>
  );
}

// A quiet, static hint of the knowledge graph — the feature this whole
// project is building toward, even though the interactive canvas itself is
// a later phase. Purely decorative: aria-hidden, sits behind the copy.
function GraphBackdrop() {
  const nodes = [
    [60, 60], [220, 30], [380, 90], [520, 40],
    [90, 200], [300, 220], [480, 190], [640, 130],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [0, 4], [1, 5], [2, 5], [3, 6], [5, 6], [6, 7],
  ];

  return (
    <svg
      aria-hidden
      viewBox="0 0 700 260"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 w-full opacity-[0.07]"
      preserveAspectRatio="xMidYMin slice"
    >
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          stroke="var(--primary)"
          strokeWidth="1.5"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={5} fill="var(--primary)" />
      ))}
    </svg>
  );
}
