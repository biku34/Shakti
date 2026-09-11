"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import { Btn, ErrorNote, Field, inputClass } from "@/components/ui";

const DEMO_PASSWORD = "password123";

const DEMO: { email: string; name: string; role: string; emoji: string }[] = [
  { email: "rahul@demo.reip", name: "Rahul", role: "Trader", emoji: "⚡" },
  { email: "ramesh@demo.reip", name: "Ramesh", role: "Trader", emoji: "⚡" },
  { email: "utility@demo.reip", name: "Utility", role: "Feeder & settlement", emoji: "🏭" },
  { email: "regulator@demo.reip", name: "Regulator", role: "Market oversight", emoji: "⚖️" },
  { email: "cert@demo.reip", name: "Certificate Body", role: "Issues RECs", emoji: "📜" },
  { email: "auditor@demo.reip", name: "Auditor", role: "REC provenance", emoji: "🔍" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function login(withEmail: string, withPassword: string) {
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email: withEmail, password: withPassword } });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
    } catch {
      /* handled in login() */
    } finally {
      setBusy(false);
    }
  }

  async function directLogin(demoEmail: string) {
    setPending(demoEmail);
    try {
      await login(demoEmail, DEMO_PASSWORD);
    } catch {
      setPending(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-4xl">
        <div className="mb-6 text-center">
          <Link href="/" className="text-sm font-medium text-leaf hover:underline">
            ← Renewable Energy Intelligence
          </Link>
        </div>

        {/* Two folds of one card, side by side */}
        <div className="grid overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm md:grid-cols-2">
          {/* ── Fold 1: credentials sign-in ──────────────────── */}
          <div className="p-8">
            <h1 className="text-2xl font-bold text-neutral-900">Sign in</h1>
            <p className="mt-1 text-sm text-neutral-500">Use your account credentials.</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label="Email">
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </Field>
              <Field label="Password">
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <ErrorNote error={error} />
              <Btn type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Btn>
            </form>

            <p className="mt-4 text-sm text-neutral-500">
              No account?{" "}
              <Link href="/register" className="font-medium text-leaf hover:underline">
                Register
              </Link>
            </p>
          </div>

          {/* ── Fold 2: one-click demo logins ────────────────── */}
          <div className="border-t border-neutral-200 bg-neutral-50/60 p-8 md:border-l md:border-t-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Quick demo login
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              One click signs you straight in (password: {DEMO_PASSWORD}).
            </p>

            <div className="mt-5 grid grid-cols-1 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => directLogin(d.email)}
                  disabled={pending !== null}
                  className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-left transition hover:border-leaf/50 hover:shadow-sm disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-leaf/10 text-base">
                    {d.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-neutral-900">{d.name}</span>
                    <span className="block truncate text-xs text-neutral-400">{d.role}</span>
                  </span>
                  <span className="text-sm font-medium text-neutral-300 transition group-hover:text-leaf">
                    {pending === d.email ? "…" : "→"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
