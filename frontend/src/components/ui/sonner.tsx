"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useMounted } from "@/hooks/use-mounted"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  // Same hydration hazard as theme-toggle.tsx: next-themes' `theme` can
  // already reflect localStorage on the client's first (hydration) render,
  // while the server always sees "system" (no localStorage access). Sonner
  // bakes theme into a data-sonner-theme attribute on first render, so
  // passing a value that differs from SSR's "system" here would carry the
  // same mismatch into Sonner's own markup. Hold at "system" until mounted.
  const mounted = useMounted()

  return (
    <Sonner
      theme={(mounted ? theme : "system") as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !rounded-xl !border-border !shadow-floating",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
