"use client";

import { LogOut, Network } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export function Sidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const isWorkspaces = pathname === "/workspaces";

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Network className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">NeuroVault</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        <Link
          href="/workspaces"
          className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            isWorkspaces
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Workspaces
        </Link>
      </nav>

      <div className="border-t p-3">
        {userEmail && (
          <p className="mb-2 truncate px-3 text-xs text-muted-foreground">{userEmail}</p>
        )}
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
