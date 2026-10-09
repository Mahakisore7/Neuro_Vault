"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export function DataExportCard() {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const res = await api.get<Blob>("/users/me/export", { responseType: "blob" });
      const disposition = String(res.headers["content-disposition"] ?? "");
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "neurovault-export.json";
      // An object URL and a synthetic click: the request has to go through
      // the authenticated api client, which a plain <a href> can't do.
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Couldn't export your data. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Your data</CardTitle>
        <CardDescription>
          Download everything you&rsquo;ve created (workspaces, notebooks, notes, tags, links,
          collections and flashcards) as one JSON file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={handleExport} disabled={busy}>
          <Download />
          {busy ? "Preparing…" : "Export data"}
        </Button>
      </CardContent>
    </Card>
  );
}
