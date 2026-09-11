"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import {
  Card, Stat, Table, Td, StatusBadge, Tabs, Btn, TxLink, useApi, useToast,
} from "@/components/ui";

type Rec = {
  _id: string;
  serial: string;
  energyMwh: number;
  status: string;
  issueTxHash: string | null;
  generationWindow: { from: string; to: string };
  backingReadingIds: string[];
};
type Provenance = {
  certificate: Rec;
  backingReadings: { _id: string; timestamp: string; exportKwh: number; generationKwh: number; verified: boolean }[];
  verification: { verified: boolean; expected: string; actual: string; txHash: string | null };
};

const TABS = [
  { id: "queue", label: "Issuance Queue" },
  { id: "evidence", label: "Generation Evidence" },
  { id: "registry", label: "REC Registry" },
];

export default function CertificateBodyDashboard() {
  const { show, node } = useToast();
  const queue = useApi<Rec[]>("/api/rec/issuance-queue", 5000);
  const registry = useApi<Rec[]>("/api/rec", 6000);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidence = useApi<Provenance>(evidenceId ? `/api/rec/${evidenceId}/provenance` : null);

  async function approve(id: string) {
    try {
      const r = await api<{ alertsRaised: number }>(`/api/rec/${id}/approve`, { method: "POST" });
      show(r.alertsRaised > 0 ? `Issued — but ${r.alertsRaised} fraud alert(s) raised!` : "REC issued & anchored");
      queue.refetch(); registry.refetch();
    } catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <Tabs tabs={TABS}>
      {(active) => (
        <>
          {active === "queue" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Pending approval" value={queue.data?.length ?? "—"} accent="solar" />
                <Stat label="Issued" value={(registry.data ?? []).filter((r) => r.status === "issued").length} accent="leaf" />
                <Stat label="Revoked" value={(registry.data ?? []).filter((r) => r.status === "revoked").length} accent="red" />
              </div>
              <Card title="Pending RECs">
                <Table head={["Serial", "Energy MWh", "Window", "Backing readings", "Actions"]} rows={queue.data?.length ?? 0} empty="Queue empty — prosumers request RECs from verified generation.">
                  {queue.data?.map((r) => (
                    <tr key={r._id}>
                      <Td className="font-mono text-xs">{r.serial}</Td>
                      <Td className="tabular-nums">{r.energyMwh}</Td>
                      <Td className="text-xs text-neutral-400">{new Date(r.generationWindow.from).toLocaleDateString()} – {new Date(r.generationWindow.to).toLocaleDateString()}</Td>
                      <Td className="tabular-nums">{r.backingReadingIds.length}</Td>
                      <Td>
                        <div className="flex gap-1">
                          <Btn size="sm" variant="ghost" onClick={() => setEvidenceId(r._id)}>Evidence</Btn>
                          <Btn size="sm" onClick={() => approve(r._id)}>Approve & anchor</Btn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          )}

          {active === "evidence" && (
            <div className="space-y-6">
              <Card title="Generation evidence">
                {!evidenceId && <p className="text-sm text-neutral-400">Pick a REC from the Issuance Queue (“Evidence”) to inspect its backing readings.</p>}
                {evidenceId && evidence.data && (
                  <>
                    <div className="mb-4 grid gap-4 sm:grid-cols-3">
                      <Stat label="Serial" value={<span className="font-mono text-sm">{evidence.data.certificate.serial}</span>} />
                      <Stat label="Claimed" value={(evidence.data.certificate.energyMwh * 1000).toFixed(3)} unit="kWh" />
                      <Stat label="Backing export" value={evidence.data.backingReadings.reduce((s, r) => s + r.exportKwh, 0).toFixed(3)} unit="kWh" accent="leaf" />
                    </div>
                    <Table head={["Timestamp", "Generation kWh", "Export kWh", "Verified"]} rows={evidence.data.backingReadings.length}>
                      {evidence.data.backingReadings.map((r) => (
                        <tr key={r._id}>
                          <Td className="text-xs text-neutral-400">{new Date(r.timestamp).toLocaleString()}</Td>
                          <Td className="tabular-nums">{r.generationKwh.toFixed(3)}</Td>
                          <Td className="tabular-nums text-leaf">{r.exportKwh.toFixed(3)}</Td>
                          <Td><StatusBadge value={r.verified ? "issued" : "failed"} /></Td>
                        </tr>
                      ))}
                    </Table>
                  </>
                )}
              </Card>
            </div>
          )}

          {active === "registry" && (
            <Card title="REC registry">
              <Table head={["Serial", "Energy MWh", "Status", "Issue anchor"]} rows={registry.data?.length ?? 0}>
                {registry.data?.map((r) => (
                  <tr key={r._id}>
                    <Td className="font-mono text-xs">{r.serial}</Td>
                    <Td className="tabular-nums">{r.energyMwh}</Td>
                    <Td><StatusBadge value={r.status} /></Td>
                    <Td><TxLink hash={r.issueTxHash} /></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
          {node}
        </>
      )}
    </Tabs>
  );
}
