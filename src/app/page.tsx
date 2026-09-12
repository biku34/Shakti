"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

// Leaflet touches `window`, so load the hero map client-side only.
const LandingMap = dynamic(() => import("@/components/LandingMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-neutral-100" />,
});

const FEATURES: { icon: string; title: string; blurb: string; accent: string }[] = [
  {
    icon: "⚡",
    title: "P2P Energy Trading",
    blurb: "Localized marketplace matching rooftop solar to nearby demand.",
    accent: "text-solar",
  },
  {
    icon: "🛡️",
    title: "REC Fraud Detection",
    blurb: "Tamper-evident certificates guarded by a pluggable rule engine.",
    accent: "text-leaf",
  },
  {
    icon: "🔗",
    title: "On-chain Anchoring",
    blurb: "Provenance for every certificate, anchored on Polygon.",
    accent: "text-grid",
  },
  {
    icon: "📊",
    title: "Grid Intelligence",
    blurb: "Live feeder congestion, load transfer & settlement.",
    accent: "text-blue-700",
  },
];

export default function Home() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* ── The whole page IS the interactive Gandhinagar map ───── */}
      <div className="absolute inset-0 z-0 [&_.leaflet-tile]:saturate-[1.35] [&_.leaflet-tile]:contrast-[1.08] [&_.leaflet-tile]:brightness-[0.99]">
        <LandingMap />
      </div>

      {/*
        A single soft wash over the same map — strongest on the left (so text
        reads), fading seamlessly into the live map on the right. No panel,
        no border, no second section. pointer-events-none so the map still
        drags & zooms underneath the wash.
      */}
      <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-r from-white/[0.98] from-0% via-white/90 via-28% to-transparent to-55%" />

      {/* Content floats directly on the map; only controls capture clicks. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-full flex-col justify-center gap-7 overflow-hidden px-8 py-6 [text-shadow:0_1px_10px_rgba(255,255,255,0.9)] sm:px-12 lg:w-[46%] lg:max-w-xl lg:py-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-700 text-2xl text-white shadow-sm [text-shadow:none]">
            ⚡
          </span>
          <span className="text-3xl font-bold tracking-tight text-blue-950">
            Shakti
          </span>
        </div>

        {/* Hero copy */}
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
            Gandhinagar · Pilot Grid
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.1] tracking-tight text-blue-950 sm:text-5xl">
            Power to the people.
            <br />
            <span className="text-leaf">Literally.</span>
          </h1>
          <p className="mt-4 max-w-lg text-lg font-medium leading-relaxed text-blue-900/90">
            Trade energy directly with neighbours and the industry.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-3 [text-shadow:none] sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-white/70 bg-white/75 p-3.5 shadow-sm backdrop-blur-sm"
              >
                <div className={`text-lg ${f.accent}`}>{f.icon}</div>
                <h2 className="mt-1.5 text-sm font-semibold text-blue-950">{f.title}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-blue-900/70">{f.blurb}</p>
              </div>
            ))}
          </div>

          <div className="pointer-events-auto mt-6 flex flex-wrap items-center gap-3 [text-shadow:none]">
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-800"
            >
              Explore the platform
              <span className="transition group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center rounded-lg border border-blue-200 bg-white/80 px-5 py-2.5 text-sm font-medium text-blue-800 backdrop-blur-sm transition hover:bg-white"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>

      {/* Map hint badge */}
      <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-full border border-white/70 bg-white/85 px-3 py-1 text-xs font-medium text-blue-800 shadow-sm backdrop-blur">
        📍 Gandhinagar, Gujarat · drag &amp; zoom the live grid
      </div>
    </main>
  );
}
