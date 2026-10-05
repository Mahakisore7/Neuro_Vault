"use client";

import {
  FolderKanban,
  GraduationCap,
  Inbox,
  Library,
  LogOut,
  Network,
  Tags,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useFlashcardSummary } from "@/hooks/use-flashcards";
import { useMe } from "@/hooks/use-user";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/workspaces", label: "Workspaces", icon: FolderKanban },
  { href: "/unfiled", label: "Unfiled", icon: Inbox },
  { href: "/collections", label: "Collections", icon: Library },
  { href: "/review", label: "Review", icon: GraduationCap },
  { href: "/tags", label: "Tags", icon: Tags },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/profile", label: "Profile", icon: User },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user } = useMe();
  const { data: flashcards } = useFlashcardSummary();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Network className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">NeuroVault</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          // Subpages (a notebook, a single collection) still highlight their section.
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className="size-4" />
              {item.label}
              {item.href === "/review" && flashcards && flashcards.due > 0 && (
                <span
                  aria-label={`${flashcards.due} due`}
                  className={`ml-auto rounded-full px-1.5 text-xs tabular-nums ${
                    active ? "bg-primary-foreground/20" : "bg-primary/10 text-primary"
                  }`}
                >
                  {flashcards.due}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <Link
          href="/profile"
          className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
        >
          <Avatar className="size-7">
            <AvatarImage src={user?.avatar_url ?? undefined} alt={user?.display_name ?? ""} />
            <AvatarFallback>
              {user ? user.display_name.slice(0, 2).toUpperCase() : <User className="size-3.5" />}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {user?.display_name ?? "Loading…"}
            </span>
            {user?.email && (
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            )}
          </span>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
