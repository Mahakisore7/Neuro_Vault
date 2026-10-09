"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export function DeleteAccountCard({ email }: { email: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  // Typing the address rather than one more click, because this can't be
  // undone: the extra step is in proportion to what's lost.
  const confirmed = typed.trim().toLowerCase() === email.toLowerCase();

  async function handleDelete() {
    setBusy(true);
    try {
      await api.delete("/users/me");
    } catch {
      toast.error("Couldn't delete your account. Nothing was removed.");
      setBusy(false);
      return;
    }
    // The login no longer exists; clear this device's session and cache.
    await supabase.auth.signOut({ scope: "local" });
    qc.clear();
    toast.success("Your account and all its data were deleted");
    router.replace("/");
  }

  return (
    <Card className="mt-6 border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Delete account</CardTitle>
        <CardDescription>
          Permanently delete your account and everything in it. This can&rsquo;t be undone, so
          export your data first if you want a copy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 />
          Delete account…
        </Button>
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) setTyped("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Every workspace, notebook, note, link, tag, collection and flashcard is deleted with
              it, and you&rsquo;re signed out. This can&rsquo;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-email">
              Type <span className="font-mono">{email}</span> to confirm
            </Label>
            <Input
              id="confirm-email"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!confirmed || busy}>
              {busy ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
