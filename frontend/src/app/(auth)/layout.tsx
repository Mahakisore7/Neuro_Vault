import { Network } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Network className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">NeuroVault</h1>
          <p className="text-sm text-muted-foreground">A knowledge base where notes form a graph.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
