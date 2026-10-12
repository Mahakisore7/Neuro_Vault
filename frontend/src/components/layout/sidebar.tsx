"use client";

import {
  FolderKanban,
  GraduationCap,
  History,
  Inbox,
  LayoutDashboard,
  Library,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Tags,
  Trash2,
  User,
} from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useMemo } from "react";

import { Logo, LogoMark } from "@/components/logo";
import { SPRING } from "@/components/motion";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFlashcardSummary } from "@/hooks/use-flashcards";
import { useAllNotes } from "@/hooks/use-notes";
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

const RECENT_COUNT = 5;

const SECTION_LABEL =
  "px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-sidebar-foreground/85 uppercase";

/** One destination. In the icon rail it shrinks to an icon with a tooltip. */
function NavRow({
  href,
  label,
  icon: Icon,
  active,
  badge,
  collapsed,
  group,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof User;
  active: boolean;
  badge?: number;
  collapsed: boolean;
  group: string;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={`group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none ${
        collapsed ? "justify-center px-0" : "px-2.5"
      } ${
        active
          ? "text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      }`}
    >
      {active && (
        // One pill that slides from the old destination to the new one.
        <motion.span
          layoutId={`${group}-nav-pill`}
          transition={SPRING}
          aria-hidden
          className="absolute inset-0 rounded-md bg-sidebar-accent shadow-soft"
        />
      )}
      <Icon
        className={`relative size-4 shrink-0 transition-opacity ${
          active ? "text-sidebar-primary" : "opacity-70 group-hover:opacity-100"
        }`}
      />
      {!collapsed && <span className="relative truncate">{label}</span>}
      {badge ? (
        <span
          aria-label={`${badge} due`}
          className={`min-w-5 rounded-full bg-sidebar-primary px-1.5 text-center text-[11px] leading-4.5 font-semibold text-sidebar-primary-foreground tabular-nums ${
            collapsed
              ? "absolute top-0 right-0 min-w-4 px-1 text-[10px] leading-4"
              : "relative ml-auto"
          }`}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * collapsed: an icon rail (labels move into tooltips). onNavigate lets the
 * mobile drawer close itself once a destination is picked; onToggle is the
 * desktop collapse button (absent in the drawer).
 */
export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user } = useMe();
  const { data: flashcards } = useFlashcardSummary();
  const { data: allNotes } = useAllNotes();
  // The desktop sidebar and the mobile drawer can both be mounted; their
  // active-indicator animations must not try to share one layout id.
  const group = useId();

  // Pinned notes, then the few most recently edited ones: the notes you are
  // most likely to want next, one click from anywhere.
  const { pinned, recent } = useMemo(() => {
    const notes = allNotes ?? [];
    const byRecent = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return {
      pinned: notes.filter((n) => n.pinned),
      recent: byRecent.filter((n) => !n.pinned).slice(0, RECENT_COUNT),
    };
  }, [allNotes]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const noteSections = [
    { label: "Pinned", notes: pinned },
    { label: "Recent", notes: recent },
  ].filter((s) => s.notes.length > 0);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-out-expo ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      <div
        className={`flex h-12 shrink-0 items-center ${
          collapsed ? "justify-center" : "justify-between pr-2 pl-4"
        }`}
      >
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label="NeuroVault home"
          className="rounded-md text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          {collapsed ? <LogoMark className="size-6" /> : <Logo markClassName="size-6" />}
        </Link>
        {onToggle && !collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse sidebar"
                onClick={onToggle}
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
              >
                <PanelLeftClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar · Ctrl \</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="px-2 pt-1 pb-2">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <NewNoteButton
                variant="outline"
                size="icon"
                aria-label="New note"
                onCreated={onNavigate}
                className="w-full bg-background dark:bg-sidebar-accent/40"
              >
                {null}
              </NewNoteButton>
            </TooltipTrigger>
            <TooltipContent side="right">New note</TooltipContent>
          </Tooltip>
        ) : (
          <NewNoteButton
            variant="outline"
            onCreated={onNavigate}
            className="h-8 w-full justify-start gap-2 bg-background px-2.5 text-[13px] dark:bg-sidebar-accent/40"
          />
        )}
      </div>

      <nav
        aria-label="Main"
        className="flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-2 pt-1 pb-4"
      >
        <LayoutGroup id={group}>
          {NAV_GROUPS.map((g, i) => (
            <div key={g.label ?? i} className="space-y-px">
              {g.label &&
                (collapsed ? (
                  <div aria-hidden className="mx-2 mb-1.5 h-px bg-sidebar-border" />
                ) : (
                  <p className={SECTION_LABEL}>{g.label}</p>
                ))}
              {g.items.map((item) => (
                <NavRow
                  key={item.href}
                  {...item}
                  active={isActive(item.href)}
                  badge={item.href === "/review" ? flashcards?.due : undefined}
                  collapsed={collapsed}
                  group={group}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))}
        </LayoutGroup>

        {/* Notes you reach for most, one click from any page. Hidden in the
            rail, where there's no room for titles. */}
        {!collapsed &&
          noteSections.map((s) => (
            <div key={s.label} className="space-y-px">
              <p className={SECTION_LABEL}>
                {s.label === "Pinned" && <Pin className="mr-1 inline size-3 -translate-y-px" />}
                {s.label}
              </p>
              {s.notes.map((n) => {
                const href = `/notes/${n.id}`;
                const active = pathname === href;
                return (
                  <Link
                    key={n.id}
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={n.title}
                    className={`flex h-7 items-center rounded-md px-2.5 text-[13px] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none ${
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <span className="truncate">{n.title}</span>
                  </Link>
                );
              })}
            </div>
          ))}
      </nav>

      <div
        className={`flex border-sidebar-border p-2 ${
          collapsed ? "flex-col items-center gap-1" : "items-center gap-1 border-t"
        }`}
      >
        <Link
          href="/profile"
          onClick={onNavigate}
          aria-current={pathname === "/profile" ? "page" : undefined}
          aria-label={collapsed ? "Profile" : undefined}
          className={`flex min-w-0 items-center gap-2.5 rounded-md py-1.5 transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none ${
            collapsed ? "justify-center px-1.5" : "flex-1 px-2"
          } ${pathname === "/profile" ? "bg-sidebar-accent" : ""}`}
        >
          <Avatar className="size-7">
            <AvatarImage src={user?.avatar_url ?? undefined} alt={user?.display_name ?? ""} />
            <AvatarFallback className="bg-accent text-[11px] font-semibold text-accent-foreground">
              {user ? initials(user.display_name) : <User className="size-3.5" />}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
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
          )}
        </Link>
        {collapsed && onToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Expand sidebar"
                onClick={onToggle}
                className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
              >
                <PanelLeftOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar · Ctrl \</TooltipContent>
          </Tooltip>
        )}
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
          <TooltipContent side={collapsed ? "right" : "top"}>Sign out</TooltipContent>
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
