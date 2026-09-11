"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import { Btn, ErrorNote, Field, inputClass, useApi } from "@/components/ui";

type Feeder = { _id: string; code: string; name: string };

const ROLES = [
  { key: "prosumer", label: "Prosumer (rooftop solar, sells surplus)" },
  { key: "consumer", label: "Consumer (buys local energy)" },
  { key: "utility", label: "Utility Company" },
  { key: "regulator", label: "Regulator" },
  { key: "certificate_body", label: "Certificate Body" },
  { key: "auditor", label: "Auditor" },
];

export default function RegisterPage() {
  const router = useRouter();
  const { data: feeders } = useApi<Feeder[]>("/api/feeders");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "consumer",
    feederId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsFeeder = form.role === "prosumer" || form.role === "consumer";

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: {
          ...form,
          feederId: needsFeeder ? form.feederId || undefined : undefined,
        },
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold">Create account</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        </Field>
        <Field label="Password (min 8 chars)">
          <input className={inputClass} type="password" minLength={8} value={form.password} onChange={(e) => set("password", e.target.value)} required />
        </Field>
        <Field label="Role">
          <select className={inputClass} value={form.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </Field>
        {needsFeeder && (
          <Field label="Feeder (locality)">
            <select className={inputClass} value={form.feederId} onChange={(e) => set("feederId", e.target.value)} required>
              <option value="">Select a feeder…</option>
              {(feeders ?? []).map((f) => (
                <option key={f._id} value={f._id}>{f.name}</option>
              ))}
            </select>
          </Field>
        )}
        <ErrorNote error={error} />
        <Btn type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</Btn>
      </form>
      <p className="mt-4 text-sm text-neutral-500">
        Have an account?{" "}
        <Link href="/login" className="font-medium text-leaf hover:underline">Sign in</Link>
      </p>
    </main>
  );
}
