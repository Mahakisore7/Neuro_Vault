"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // supabase-js already parsed the OAuth redirect and exchanged it for a
    // session before this component's effect body runs (detectSessionInUrl:
    // true in lib/supabase.ts) - getSession() below is just reading the
    // result, not doing the exchange itself. onAuthStateChange is the
    // fallback for the rare case where that resolves a tick later.
    let settled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !settled) {
        settled = true;
        router.replace("/workspaces");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !settled) {
        settled = true;
        router.replace("/workspaces");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) setFailed(true);
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router]);

  if (failed) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="font-medium">Sign-in didn&apos;t go through</p>
          <p className="text-sm text-muted-foreground">
            The provider didn&apos;t return a session. Try again.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
      </CardContent>
    </Card>
  );
}
