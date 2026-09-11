import Link from "next/link";

const ROLES: { key: string; label: string; blurb: string }[] = [
  { key: "prosumer", label: "Trader", blurb: "Buy & sell energy, track earnings & RECs." },
  { key: "utility", label: "Utility", blurb: "Monitor feeder load, congestion & settlement." },
  { key: "regulator", label: "Regulator", blurb: "Market oversight & fraud dashboards." },
  { key: "certificate_body", label: "Certificate Body", blurb: "Issue & validate RECs." },
  { key: "auditor", label: "Auditor", blurb: "Trace REC provenance, verify on-chain anchors." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <p className="text-sm font-medium text-leaf">Gandhinagar · Renewable Energy Intelligence</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">
        P2P Energy Trading + REC Fraud Detection
      </h1>
      <p className="mt-4 max-w-2xl text-neutral-600">
        A single stack where metered rooftop-solar generation drives both a localized
        peer-to-peer marketplace and tamper-evident renewable energy certificates —
        anchored on Polygon, guarded by a pluggable rule engine.
      </p>

      <div className="mt-6 flex gap-3">
        <Link href="/login" className="inline-flex items-center rounded-lg bg-leaf px-5 py-2.5 text-sm font-medium text-white hover:bg-green-700">
          Sign in
        </Link>
        <Link href="/register" className="inline-flex items-center rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          Create account
        </Link>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.key} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">{r.label}</h2>
            <p className="mt-1 text-sm text-neutral-500">{r.blurb}</p>
          </div>
        ))}
      </div>

      <p className="mt-12 text-sm text-neutral-500">
        Scaffold ready — see <code className="rounded bg-neutral-100 px-1">README.md</code> for
        setup, API routes, and the demo flow. Dashboards are stubbed; the backend services
        (ingestion, pricing, matching, REC lifecycle, fraud detection, anchoring) are wired.
      </p>
    </main>
  );
}
