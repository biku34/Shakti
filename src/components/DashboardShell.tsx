"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { useApi, Badge } from "@/components/ui";
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

const ROLE_LABEL: Record<Role, string> = {
  prosumer: "Prosumer",
  consumer: "Consumer",
  utility: "Utility",
  regulator: "Regulator",
  certificate_body: "Certificate Body",
  auditor: "Auditor",
};

export default function DashboardShell({ role, feederId }: { role: Role; feederId: string | null }) {
  const router = useRouter();
  // Poll /api/me so the credit balance stays live after trades settle.
  const { data: me } = useApi<Me>("/api/me", 5000);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const showCredits = role === "prosumer" || role === "consumer";

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-leaf">⚡ REIP</span>
            <Badge tone="green">{ROLE_LABEL[role]}</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {showCredits && me && (
              <span className="tabular-nums text-neutral-600">
                Credits: <strong className="text-neutral-900">{me.creditBalance.toFixed(2)}</strong>
              </span>
            )}
            <span className="text-neutral-500">{me?.name ?? "…"}</span>
            <button onClick={logout} className="rounded-lg border border-neutral-300 px-3 py-1 text-neutral-700 hover:bg-neutral-50">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
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
