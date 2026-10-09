"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

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

export function PasswordCard() {
  // Accounts created with Google have no password; for them this card
  // adds one, so they can also sign in with email.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const providers = (user?.app_metadata?.providers as string[] | undefined) ?? [];
      setHasPassword(providers.includes("email"));
    });
  }, []);

  async function onSubmit({ password }: FormValues) {
    setServerError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setServerError(
        error.code === "same_password"
          ? "That's your current password. Choose a different one."
          : error.code === "reauthentication_needed"
            ? "For security, sign out and back in, then change your password."
            : error.message || "Couldn't update the password.",
      );
      return;
    }
    reset({ password: "", confirmPassword: "" });
    toast.success(
      hasPassword ? "Password changed" : "Password set. You can now also sign in with email.",
    );
    setHasPassword(true);
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">
          {hasPassword === false ? "Set a password" : "Password"}
        </CardTitle>
        <CardDescription>
          {hasPassword === false
            ? "You sign in with Google. Add a password to also sign in with your email."
            : "Choose a new password for signing in with your email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>
          {serverError && <p className="text-sm text-destructive sm:col-span-2">{serverError}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={isSubmitting || hasPassword === null}>
              {isSubmitting
                ? "Saving…"
                : hasPassword === false
                  ? "Set password"
                  : "Change password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
