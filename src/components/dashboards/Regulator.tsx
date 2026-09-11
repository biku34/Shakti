"use client";

import { api } from "@/lib/client";
import {
  Card, Stat, Table, Td, StatusBadge, Tabs, Btn, useApi, useToast,
} from "@/components/ui";

type Market = {
  settledTrades: number;
  tradedEnergyKwh: number;
  tradedCredits: number;
  recsByStatus: Record<string, number>;
  alertsByStatus: Record<string, number>;
};
type Alert = {
  _id: string;
  type: string;
  severity: string;
  subjectType: string;
  subjectId: string;
  ruleId: string;
  evidence: Record<string, unknown>;
  status: string;
  createdAt: string;
};

const TABS = [
  { id: "market", label: "Market Overview" },
  { id: "fraud", label: "Fraud Dashboard" },
  { id: "compliance", label: "Compliance Reports" },
];

export default function RegulatorDashboard() {
  const { show, node } = useToast();
  const market = useApi<Market>("/api/reports/market", 6000);
  const alerts = useApi<Alert[]>("/api/fraud/alerts", 4000);
  const m = market.data;

  async function setStatus(id: string, status: string) {
    try { await api(`/api/fraud/alerts/${id}/status`, { method: "POST", body: { status } }); show(`Alert → ${status}`); alerts.refetch(); }
    catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }
  async function revoke(subjectId: string) {
    try { await api(`/api/rec/${subjectId}/revoke`, { method: "POST" }); show("REC revoked (anchored)"); alerts.refetch(); market.refetch(); }
    catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }
  async function scan() {
    try { const r = await api<{ alertsRaised: number }>("/api/fraud/scan", { method: "POST" }); show(`Scan complete — ${r.alertsRaised} new alert(s)`); alerts.refetch(); }
    catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }

  const openAlerts = (alerts.data ?? []).filter((a) => ["open", "investigating"].includes(a.status));

  return (
    <Tabs tabs={TABS}>
      {(active) => (
        <>
          {active === "market" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Settled trades" value={m?.settledTrades ?? "—"} />
                <Stat label="Energy traded" value={m?.tradedEnergyKwh.toFixed(1) ?? "—"} unit="kWh" accent="leaf" />
                <Stat label="Credits settled" value={m?.tradedCredits.toFixed(1) ?? "—"} unit="cr" />
                <Stat label="Open alerts" value={openAlerts.length} accent={openAlerts.length ? "red" : "leaf"} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="RECs by status"><KeyVals data={m?.recsByStatus} /></Card>
                <Card title="Fraud alerts by status"><KeyVals data={m?.alertsByStatus} /></Card>
              </div>
            </div>
          )}

          {active === "fraud" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-neutral-500">{openAlerts.length} open · {alerts.data?.length ?? 0} total</p>
                <Btn size="sm" onClick={scan}>Run full scan</Btn>
              </div>
              <Card title="Fraud alerts">
                <Table head={["Rule", "Type", "Severity", "Subject", "Evidence", "Status", "Actions"]} rows={alerts.data?.length ?? 0} empty="No alerts — inject a fault in the simulator.">
                  {alerts.data?.map((a) => (
                    <tr key={a._id}>
                      <Td className="font-mono text-xs">{a.ruleId}</Td>
                      <Td>{a.type}</Td>
                      <Td><StatusBadge value={a.severity} /></Td>
                      <Td className="text-xs text-neutral-500">{a.subjectType}</Td>
                      <Td className="max-w-xs truncate font-mono text-xs text-neutral-400" title={JSON.stringify(a.evidence)}>{JSON.stringify(a.evidence)}</Td>
                      <Td><StatusBadge value={a.status} /></Td>
                      <Td>
                        <div className="flex gap-1">
                          {a.status === "open" && <Btn size="sm" variant="ghost" onClick={() => setStatus(a._id, "investigating")}>Investigate</Btn>}
                          {["open", "investigating"].includes(a.status) && (
                            <>
                              <Btn size="sm" variant="danger" onClick={() => setStatus(a._id, "confirmed")}>Confirm</Btn>
                              <Btn size="sm" variant="ghost" onClick={() => setStatus(a._id, "dismissed")}>Dismiss</Btn>
                            </>
                          )}
                          {a.subjectType === "rec" && a.status === "confirmed" && (
                            <Btn size="sm" variant="danger" onClick={() => revoke(a.subjectId)}>Revoke REC</Btn>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          )}

          {active === "compliance" && (
            <div className="space-y-6">
              <Card title="Compliance snapshot">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Stat label="Confirmed frauds" value={m?.alertsByStatus?.confirmed ?? 0} accent="red" />
                  <Stat label="Revoked RECs" value={m?.recsByStatus?.revoked ?? 0} accent="red" />
                  <Stat label="Issued RECs" value={m?.recsByStatus?.issued ?? 0} accent="leaf" />
                </div>
              </Card>
              <Card title="Alert breakdown by status"><KeyVals data={m?.alertsByStatus} /></Card>
              <p className="text-xs text-neutral-400">Full audit-trail export is available to auditors (§6.10, FR-10.3).</p>
            </div>
          )}
          {node}
        </>
      )}
    </Tabs>
  );
}

function KeyVals({ data }: { data?: Record<string, number> }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <p className="text-sm text-neutral-400">No data yet.</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5">
          <StatusBadge value={k} />
          <span className="tabular-nums font-semibold">{v}</span>
        </div>
      ))}
    </div>
  );
}
