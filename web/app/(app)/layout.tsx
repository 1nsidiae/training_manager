import { AppViewport } from "@/components/app-viewport";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppViewport>
      <div className="app-shell mx-auto min-h-dvh max-w-lg pb-32 pt-[max(20px,env(safe-area-inset-top))]">{children}</div>
    </AppViewport>
  );
}
