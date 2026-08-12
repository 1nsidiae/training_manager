import { BottomNav } from "@/components/nav";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <div className="app-shell mx-auto min-h-dvh max-w-lg px-4 pb-32 pt-[max(20px,env(safe-area-inset-top))]">{children}</div>
      <BottomNav />
    </>
  );
}
