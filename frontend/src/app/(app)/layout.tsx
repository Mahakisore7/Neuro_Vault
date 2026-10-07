"use client";

import { Menu, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmProvider } from "@/components/confirm-dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SearchDialog } from "@/components/search/search-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function AppLayout({ children }: LayoutProps<"/">) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  // Below md the sidebar is an off-canvas drawer instead of a fixed column.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setChecked(true);
    });

    // Handles sign-out in another tab, and token expiry with no refresh.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });

    return () => subscription.unsubscribe();
  }, [router]);

  // Render nothing until the check completes — this is what prevents the
  // flash of empty shell. It is a UX guarantee, not a security one: the
  // real boundary is FastAPI verifying the JWT plus Supabase RLS.
  if (!checked) {
    return <div className="flex h-screen items-center justify-center bg-background" />;
  }

  return (
    <ConfirmProvider>
      <div className="flex h-dvh bg-background">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>

        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-black/40 motion-safe:animate-in motion-safe:fade-in"
              onClick={() => setMenuOpen(false)}
            />
            <div className="relative h-full w-60 shadow-xl motion-safe:animate-in motion-safe:slide-in-from-left">
              <Sidebar onNavigate={() => setMenuOpen(false)} />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close menu"
                className="absolute top-4 right-2"
                onClick={() => setMenuOpen(false)}
              >
                <X />
              </Button>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              className="md:hidden"
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <SearchDialog />
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
            {children}
          </main>
        </div>
      </div>
    </ConfirmProvider>
  );
}
