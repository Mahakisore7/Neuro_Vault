"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/use-page-title";
import { authRedirect, supabase } from "@/lib/supabase";

// Same rule as sign-up.
const schema = z
  .object({
    password: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
type FormValues = z.infer<typeof schema>;

type LinkState = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  usePageTitle("Choose a new password");
  const router = useRouter();
  const [linkState, setLinkState] = useState<LinkState>(
    authRedirect.errorCode ? "invalid" : "checking",
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (linkState !== "checking") return;
    // Opening the emailed link signs the user in with a short-lived
    // recovery session (supabase-js reads it from the URL). No session
    // means the link was expired, already used, or never a reset link.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setLinkState(session ? "ready" : "invalid");
    });
  }, [linkState]);

  async function onSubmit({ password }: FormValues) {
    setServerError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setServerError(
        error.code === "same_password"
          ? "That's your current password. Choose a different one."
          : (error.message ?? "Couldn't update the password. Try again."),
      );
      return;
    }
    toast.success("Password updated");
    router.replace("/dashboard");
  }

  if (linkState === "checking") {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking your link…
        </CardContent>
      </Card>
    );
  }

  if (linkState === "invalid") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="font-medium">This link has expired or was already used</p>
          <p className="text-sm text-muted-foreground">
            Email links work once and only for a limited time. Request a new one.
          </p>
          <div className="mt-2 flex gap-2">
            <Button asChild>
              <Link href="/forgot-password">Send a new link</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>You&rsquo;ll stay signed in on this device afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
