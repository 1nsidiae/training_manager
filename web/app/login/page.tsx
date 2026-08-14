"use client";

import { useActionState, useEffect } from "react";
import { Activity, LockKeyhole } from "lucide-react";
import { login } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, { error: null });

  useEffect(() => {
    if (!state.error) return;
    toast.error("Inloggen niet gelukt", {
      description: state.error,
      duration: 6500,
    });
  }, [state.error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-8">
        <div className="mb-5 grid size-14 place-items-center rounded-full border border-teal/25 bg-teal/10 text-teal">
          <Activity className="size-6" />
        </div>
        <div className="label mb-2">Training Manager</div>
        <h1 className="screen-title text-[30px]">Ken je training.<br />Begrijp je herstel.</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          Je Garmin-data, trainingsplan en coachbeslissingen in één helder overzicht.
        </p>
      </div>

      <Card className="border-line-strong p-4">
        <form action={formAction}>
          <div className="mb-4 flex items-center gap-2">
            <LockKeyhole className="size-4 text-faint" />
            <h2 className="text-sm font-semibold">Veilig inloggen</h2>
          </div>

          <label className="label mb-2 block" htmlFor="email">E-mail</label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            className="mb-4"
          />

          <label className="label mb-2 block" htmlFor="password">Wachtwoord</label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mb-5"
          />

          <Button type="submit" disabled={pending} size="lg" className="w-full">
            {pending ? "Bezig…" : "Inloggen"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
