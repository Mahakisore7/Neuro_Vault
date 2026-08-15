"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { supabase } from "@/lib/supabase";

export default function AppLayout({ children }: LayoutProps<"/">) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

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
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
