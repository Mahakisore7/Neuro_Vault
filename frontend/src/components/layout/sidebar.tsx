"use client";

import {
  FolderKanban,
  GraduationCap,
  History,
  Inbox,
  LayoutDashboard,
  Library,
  LogOut,
  Tags,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Logo } from "@/components/logo";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFlashcardSummary } from "@/hooks/use-flashcards";
import { useMe } from "@/hooks/use-user";
import { supabase } from "@/lib/supabase";

// Grouped so twelve destinations scan as four ideas. Profile isn't listed:
// the account card at the bottom already links there.
// Also the "Go to" list in the command palette, so the two never disagree.
export const NAV_GROUPS: {
  label?: string;
  items: { href: string; label: string; icon: typeof User }[];
}[] = [
  { items: [{ href: "/dashboard", label: "Home", icon: LayoutDashboard }] },
  {
    label: "Library",
    items: [
      { href: "/workspaces", label: "Workspaces", icon: FolderKanban },
      { href: "/unfiled", label: "Unfiled", icon: Inbox },
      { href: "/collections", label: "Collections", icon: Library },
      { href: "/tags", label: "Tags", icon: Tags },
    ],
  },
  { label: "Study", items: [{ href: "/review", label: "Review", icon: GraduationCap }] },
  {
    label: "History",
    items: [
      { href: "/activity", label: "Activity", icon: History },
      { href: "/trash", label: "Trash", icon: Trash2 },
    ],
  },
];

/** onNavigate lets the mobile drawer close itself once a destination is picked. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user } = useMe();
  const { data: flashcards } = useFlashcardSummary();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center px-4">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="rounded-md text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <Logo markClassName="size-6" />
        </Link>
      </div>

      <div className="px-2 pt-1 pb-2">
        <NewNoteButton
          variant="outline"
          onCreated={onNavigate}
          className="h-8 w-full justify-start gap-2 bg-background px-2.5 text-[13px] dark:bg-sidebar-accent/40"
        />
      </div>

      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-2 pt-1 pb-4">
        {NAV_GROUPS.map((group, i) => (
          <div key={group.label ?? i} className="space-y-px">
            {group.label && (
              <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-sidebar-foreground/70 uppercase">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              // Subpages (a notebook, a single collection) still highlight their section.
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon
                    className={`size-4 shrink-0 ${
                      active ? "text-sidebar-primary" : "opacity-70 group-hover:opacity-100"
                    }`}
                  />
                  {item.label}
                  {item.href === "/review" && flashcards && flashcards.due > 0 && (
                    <span
                      aria-label={`${flashcards.due} due`}
                      className="ml-auto min-w-5 rounded-full bg-sidebar-primary px-1.5 text-center text-[11px] leading-[18px] font-semibold text-sidebar-primary-foreground tabular-nums"
                    >
                      {flashcards.due}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-1 border-t border-sidebar-border p-2">
        <Link
          href="/profile"
          onClick={onNavigate}
          aria-current={pathname === "/profile" ? "page" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none ${
            pathname === "/profile" ? "bg-sidebar-accent" : ""
          }`}
        >
          <Avatar className="size-7">
            <AvatarImage src={user?.avatar_url ?? undefined} alt={user?.display_name ?? ""} />
            <AvatarFallback className="bg-accent text-[11px] font-semibold text-accent-foreground">
              {user ? initials(user.display_name) : <User className="size-3.5" />}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium text-sidebar-accent-foreground">
              {user?.display_name ?? "Loading…"}
            </span>
            {user?.email && (
              <span className="block truncate text-[11px] text-sidebar-foreground">
                {user.email}
              </span>
            )}
          </span>
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              className="shrink-0 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Sign out</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}

/** "Demo Student" -> "DS"; a single name gives its first two letters. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)![0] : name.slice(0, 2)).toUpperCase();
}
