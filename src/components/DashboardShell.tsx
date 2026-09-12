"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { useApi } from "@/components/ui";
import type { Role } from "@/lib/roles";

import ProsumerDashboard from "@/components/dashboards/Prosumer";
import ConsumerDashboard from "@/components/dashboards/Consumer";
import UtilityDashboard from "@/components/dashboards/Utility";
import RegulatorDashboard from "@/components/dashboards/Regulator";
import CertificateBodyDashboard from "@/components/dashboards/CertificateBody";
import AuditorDashboard from "@/components/dashboards/Auditor";

type Me = {
  _id: string;
  name: string;
  role: Role;
  creditBalance: number;
  feederId: string | null;
};

const ROLE_META: Record<Role, { label: string; accent: string; ring: string }> = {
  prosumer: { label: "Prosumer", accent: "#f5a623", ring: "ring-amber-200" },
  consumer: { label: "Consumer", accent: "#2b6cb0", ring: "ring-blue-200" },
  utility: { label: "Utility", accent: "#0f766e", ring: "ring-teal-200" },
  regulator: { label: "Regulator", accent: "#7c3aed", ring: "ring-purple-200" },
  certificate_body: { label: "Certificate Body", accent: "#16a34a", ring: "ring-green-200" },
  auditor: { label: "Auditor", accent: "#334155", ring: "ring-slate-300" },
};

type MeterProfile = { meters: { code: string }[] };
type Feeder = { _id: string; code: string; name: string };

export default function DashboardShell({ role, feederId }: { role: Role; feederId: string | null }) {
  const router = useRouter();
  const { data: me } = useApi<Me>("/api/me", 5000);
  const { data: meterProfile } = useApi<MeterProfile>(role === "prosumer" ? "/api/meters/mine" : null, 10000);
  const { data: feeders } = useApi<Feeder[]>(feederId ? "/api/feeders" : null, 30000);
  const meta = ROLE_META[role];
  const meterCode = meterProfile?.meters?.[0]?.code ?? null;
  const feederCode = feeders?.find((f) => f._id === feederId)?.code ?? null;

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const showCredits = role === "prosumer" || role === "consumer";
  const initial = (me?.name ?? "?").charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-neutral-900">
      <header className="sticky top-0 z-20 border-b border-neutral-200/80 bg-white/85 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-2.5 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf text-white shadow-sm">⚡</span>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight">Shakti</div>
              <div className="text-[11px] text-neutral-400">Renewable Energy Intelligence</div>
            </div>
            {meterCode && (
              <span className="ml-2 hidden items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600 sm:inline-flex">
                <span className="text-neutral-400">Meter</span>
                <span className="font-mono font-medium text-neutral-800">{meterCode}</span>
              </span>
            )}
            {feederCode && (
              <span className="hidden items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600 sm:inline-flex">
                <span className="text-neutral-400">Feeder</span>
                <span className="font-mono font-medium text-neutral-800">{feederCode}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm">
            {showCredits && (
              <span className="hidden rounded-full bg-neutral-100 px-3 py-1.5 tabular-nums text-neutral-600 sm:inline-block">
                Credits <strong className="ml-1 text-neutral-900">{me ? me.creditBalance.toFixed(2) : "…"}</strong>
              </span>
            )}
            <div className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ${meta.ring}`}
                style={{ backgroundColor: meta.accent }}
              >
                {initial}
              </span>
              <span className="hidden text-neutral-600 md:inline">{me?.name ?? "…"}</span>
            </div>
            <button
              onClick={logout}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-600 transition hover:bg-neutral-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="w-full px-5 py-6 lg:px-8">
        <Dashboard role={role} feederId={feederId} />
      </main>
    </div>
  );
}

function Dashboard({ role, feederId }: { role: Role; feederId: string | null }) {
  switch (role) {
    case "prosumer":
      return <ProsumerDashboard feederId={feederId} />;
    case "consumer":
      return <ConsumerDashboard feederId={feederId} />;
    case "utility":
      return <UtilityDashboard />;
    case "regulator":
      return <RegulatorDashboard />;
    case "certificate_body":
      return <CertificateBodyDashboard />;
    case "auditor":
      return <AuditorDashboard />;
    default:
      return null;
  }
}
