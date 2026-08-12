"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type LoginState = { error: string | null };

/** Login op de server, zodat Safari de Supabase-cookie als onderdeel van het
 * HTTP-antwoord ontvangt voordat Next naar de app navigeert. */
export async function login(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Vul je e-mailadres en wachtwoord in." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      error:
        error.message.toLowerCase().includes("invalid login")
          ? "E-mailadres of wachtwoord is niet correct."
          : "Inloggen lukte niet. Controleer je verbinding en probeer opnieuw.",
    };
  }

  redirect("/");
}
