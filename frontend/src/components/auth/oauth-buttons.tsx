"use client";

import type { SVGProps } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type Provider = "google" | "github";

export function OAuthButtons() {
  const [pending, setPending] = useState<Provider | null>(null);

  async function handleClick(provider: Provider) {
    setPending(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // Success navigates away via a full-page redirect - there is no "after"
    // to handle here, only the failure-to-even-start case.
    if (error) {
      toast.error(`Couldn't start ${provider} sign-in.`);
      setPending(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => handleClick("google")}
      >
        <GoogleIcon className="size-4" />
        {pending === "google" ? "Redirecting…" : "Google"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => handleClick("github")}
      >
        <GitHubIcon className="size-4" />
        {pending === "github" ? "Redirecting…" : "GitHub"}
      </Button>
    </div>
  );
}

function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="#4285F4"
        d="M23.766 12.276c0-.818-.074-1.604-.21-2.36H12.24v4.466h6.482a5.54 5.54 0 0 1-2.4 3.633v3.02h3.878c2.27-2.09 3.566-5.166 3.566-8.76z"
      />
      <path
        fill="#34A853"
        d="M12.24 24c3.24 0 5.956-1.075 7.942-2.905l-3.878-3.02c-1.076.72-2.45 1.147-4.064 1.147-3.125 0-5.77-2.11-6.715-4.945H1.516v3.113A11.999 11.999 0 0 0 12.24 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.525 14.277a7.2 7.2 0 0 1-.376-2.277c0-.79.136-1.56.376-2.277V6.61H1.516A11.999 11.999 0 0 0 0 12c0 1.936.463 3.768 1.516 5.39l4.01-3.113z"
      />
      <path
        fill="#EA4335"
        d="M12.24 4.773c1.762 0 3.344.606 4.59 1.796l3.442-3.442C18.19 1.19 15.48 0 12.24 0 7.522 0 3.44 2.69 1.516 6.61l4.01 3.113c.945-2.835 3.59-4.95 6.715-4.95z"
      />
    </svg>
  );
}

function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.435.375.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
