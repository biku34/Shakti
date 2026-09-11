"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import { Btn, ErrorNote, Field, inputClass } from "@/components/ui";

const DEMO = [
  { email: "prosumer.011.0@demo.reip", role: "Prosumer" },
  { email: "consumer.011.0@demo.reip", role: "Consumer" },
  { email: "utility@demo.reip", role: "Utility" },
  { email: "regulator@demo.reip", role: "Regulator" },
  { email: "cert@demo.reip", role: "Certificate Body" },
  { email: "auditor@demo.reip", role: "Auditor" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <p className="text-sm font-medium text-leaf">Renewable Energy Intelligence</p>
      <h1 className="mt-1 text-2xl font-bold">Sign in</h1>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote error={error} />
        <Btn type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Btn>
      </form>

      <p className="mt-4 text-sm text-neutral-500">
        No account?{" "}
        <Link href="/register" className="font-medium text-leaf hover:underline">
          Register
        </Link>
      </p>

      <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Demo accounts (password: password123)
        </p>
        <div className="grid grid-cols-1 gap-1">
          {DEMO.map((d) => (
            <button
              key={d.email}
              onClick={() => setEmail(d.email)}
              className="flex items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-neutral-50"
            >
              <span className="text-neutral-600">{d.role}</span>
              <span className="font-mono text-xs text-neutral-400">{d.email}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
