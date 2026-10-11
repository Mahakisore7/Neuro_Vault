"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DataExportCard } from "@/components/account/data-export-card";
import { DeleteAccountCard } from "@/components/account/delete-account-card";
import { PasswordCard } from "@/components/account/password-card";
import { ErrorState } from "@/components/error-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useMe, useUpdateMe } from "@/hooks/use-user";
import { usePageTitle } from "@/hooks/use-page-title";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  display_name: z.string().min(1, "Name is required").max(100),
  bio: z.string().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

export default function ProfilePage() {
  const router = useRouter();
  const { data: user, isLoading, isError, refetch } = useMe();
  usePageTitle("Profile");
  const updateMe = useUpdateMe();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (user) reset({ display_name: user.display_name, bio: user.bio ?? "" });
  }, [user, reset]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function onSubmit(values: FormValues) {
    try {
      await updateMe.mutateAsync({ display_name: values.display_name, bio: values.bio || null });
      toast.success("Profile updated");
    } catch {
      toast.error("Couldn't update your profile.");
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2MB.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);
      // The storage path is stable across re-uploads ("avatar.<ext>"), so
      // the public URL never changes on its own - the query param is what
      // busts the browser/CDN cache for the new image.
      await updateMe.mutateAsync({ avatar_url: `${publicUrl}?v=${Date.now()}` });
      toast.success("Avatar updated");
    } catch {
      toast.error("Couldn't upload avatar.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-8">
        <Skeleton className="mb-8 h-8 w-40" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-8">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-8">
        <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.02em]">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage how you appear across NeuroVault.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal info</CardTitle>
          <CardDescription>Your name and photo, shown throughout the app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="group relative">
              <Avatar className="size-16">
                <AvatarImage src={user.avatar_url ?? undefined} alt={user.display_name} />
                <AvatarFallback className="text-lg">
                  {user.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                aria-label="Change avatar"
              >
                <Camera className="size-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Change avatar"}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">PNG, JPG or WebP. Up to 2MB.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user.email} disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="display_name">Display name</Label>
              <Input id="display_name" {...register("display_name")} />
              {errors.display_name && (
                <p className="text-sm text-destructive">{errors.display_name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea id="bio" rows={3} placeholder="A short intro…" {...register("bio")} />
              {errors.bio && <p className="text-sm text-destructive">{errors.bio.message}</p>}
            </div>

            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>Sign out of NeuroVault on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut />
            Sign out
          </Button>
        </CardContent>
      </Card>

      <PasswordCard />
      <DataExportCard />
      <DeleteAccountCard email={user.email} />
    </div>
  );
}
