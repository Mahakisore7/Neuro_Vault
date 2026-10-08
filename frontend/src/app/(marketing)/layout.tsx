import type { Metadata } from "next";

// The landing page is the one public page worth a title in the HTML itself
// (link previews, search results). Signed-in pages set theirs client-side.
export const metadata: Metadata = {
  title: "NeuroVault — notes that form a graph",
};

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return children;
}
