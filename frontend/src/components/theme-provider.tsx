"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      // next-themes injects its own flash-prevention <script> (it sets the
      // theme class on <html> before hydration, from inline JS - see its
      // source). This Next.js/React version warns in dev on ANY <script>
      // React renders, unless it's inert on the client: type="text/javascript"
      // during SSR (so the browser actually runs it while parsing), then
      // type="text/plain" once hydrated (so React sees a harmless, inert
      // element instead of "a script that will never execute"). Same trick
      // Next's own docs use for hand-rolled flash-prevention scripts.
      scriptProps={{ type: typeof window === "undefined" ? "text/javascript" : "text/plain" }}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
