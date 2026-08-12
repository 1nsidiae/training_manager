import { AppViewport } from "@/components/app-viewport";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppViewport>
      {/* Capsule 64px + safe-area + de vervaging erboven: pas daaronder mag de
          laatste kaart eindigen, anders staat die permanent in de scrim. */}
      <div className="app-shell mx-auto min-h-dvh max-w-lg pb-[calc(124px+env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        {children}
      </div>
    </AppViewport>
  );
}
