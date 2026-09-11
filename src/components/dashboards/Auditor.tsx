"use client";

import { useState } from "react";
import {
  Card, Stat, Table, Td, StatusBadge, Tabs, Btn, TxLink, useApi,
} from "@/components/ui";

type Rec = { _id: string; serial: string; energyMwh: number; status: string; issueTxHash: string | null };
type Provenance = {
  certificate: Rec & { generationWindow: { from: string; to: string } };
  backingReadings: { _id: string; timestamp: string; exportKwh: number; generationKwh: number }[];
  transactions: { _id: string; action: string; anchorTxHash: string | null; timestamp: string }[];
  verification: { verified: boolean; expected: string; actual: string; txHash: string | null };
};

const TABS = [
  { id: "provenance", label: "REC Provenance Explorer" },
  { id: "verifier", label: "On-chain Verifier" },
  { id: "export", label: "Audit Export" },
];

export default function AuditorDashboard() {
  const recs = useApi<Rec[]>("/api/rec", 8000);
  const [selected, setSelected] = useState<string | null>(null);
  const prov = useApi<Provenance>(selected ? `/api/rec/${selected}/provenance` : null);

  return (
    <Tabs tabs={TABS}>
      {(active) => (
        <>
          {active === "provenance" && (
            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <Card title="RECs">
                <div className="max-h-[520px] space-y-1 overflow-y-auto">
                  {(recs.data ?? []).map((r) => (
                    <button
                      key={r._id}
                      onClick={() => setSelected(r._id)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selected === r._id ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
                    >
                      <span className="font-mono text-xs">{r.serial}</span>
                      <StatusBadge value={r.status} />
                    </button>
                  ))}
                  {(recs.data?.length ?? 0) === 0 && <p className="px-3 py-6 text-center text-sm text-neutral-400">No RECs yet.</p>}
                </div>
              </Card>

              <div className="space-y-6">
                {!selected && <Card><p className="text-sm text-neutral-400">Select a REC to trace its full lineage.</p></Card>}
                {selected && prov.data && (
                  <>
                    <Card title="Chain-of-custody verification">
                      <div className="flex items-center gap-3">
                        <StatusBadge value={prov.data.verification.verified ? "issued" : "revoked"} />
                        <span className="text-sm font-medium">{prov.data.verification.verified ? "On-chain hash matches current record" : "MISMATCH — tamper indicator"}</span>
                        <TxLink hash={prov.data.verification.txHash} />
                      </div>
                      <div className="mt-3 space-y-1 font-mono text-xs text-neutral-400">
                        <div>expected: {prov.data.verification.expected || "—"}</div>
                        <div>actual&nbsp;&nbsp;: {prov.data.verification.actual || "—"}</div>
                      </div>
                    </Card>

                    <Card title="Backing readings (generation basis)">
                      <Table head={["Timestamp", "Generation kWh", "Export kWh"]} rows={prov.data.backingReadings.length}>
                        {prov.data.backingReadings.map((r) => (
                          <tr key={r._id}>
                            <Td className="text-xs text-neutral-400">{new Date(r.timestamp).toLocaleString()}</Td>
                            <Td className="tabular-nums">{r.generationKwh.toFixed(3)}</Td>
                            <Td className="tabular-nums text-leaf">{r.exportKwh.toFixed(3)}</Td>
                          </tr>
                        ))}
                      </Table>
                    </Card>

                    <Card title="Lifecycle transactions">
                      <Table head={["Action", "Anchor", "When"]} rows={prov.data.transactions.length}>
                        {prov.data.transactions.map((t) => (
                          <tr key={t._id}>
                            <Td><StatusBadge value={t.action === "issue" ? "issued" : t.action === "revoke" ? "revoked" : t.action} /></Td>
                            <Td><TxLink hash={t.anchorTxHash} /></Td>
                            <Td className="text-xs text-neutral-400">{new Date(t.timestamp).toLocaleString()}</Td>
                          </tr>
                        ))}
                      </Table>
                    </Card>
                  </>
                )}
              </div>
            </div>
          )}

          {active === "verifier" && <Verifier />}

          {active === "export" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Stat label="RECs in registry" value={recs.data?.length ?? "—"} />
                <Stat label="Revoked" value={(recs.data ?? []).filter((r) => r.status === "revoked").length} accent="red" />
              </div>
              <Card title="Export audit trail (FR-10.3)">
                <p className="mb-4 text-sm text-neutral-500">Full REC lifecycle with on-chain references.</p>
                <div className="flex gap-3">
                  <a href="/api/audit/export?format=csv" className="inline-flex items-center rounded-lg bg-leaf px-4 py-2 text-sm font-medium text-white hover:bg-green-700">Download CSV</a>
                  <a href="/api/audit/export?format=json" target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">View JSON</a>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </Tabs>
  );
}

function Verifier() {
  const [refType, setRefType] = useState("rec");
  const [refId, setRefId] = useState("");
  const [result, setResult] = useState<{ verified: boolean; expected: string; actual: string; txHash: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null); setResult(null);
    try {
      const res = await fetch(`/api/verify/${refType}/${refId}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "Failed");
      setResult(json.data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <Card title="On-chain verifier — re-hash a record and compare to its anchor">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Ref type</span>
          <select className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" value={refType} onChange={(e) => setRefType(e.target.value)}>
            <option value="rec">rec</option>
            <option value="trade">trade</option>
          </select>
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Record ID</span>
          <input className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs" placeholder="ObjectId" value={refId} onChange={(e) => setRefId(e.target.value)} />
        </label>
        <Btn onClick={run} disabled={!refId}>Verify</Btn>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-4 rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center gap-2">
            <StatusBadge value={result.verified ? "issued" : "revoked"} />
            <span className="text-sm font-medium">{result.verified ? "Verified — hash matches on-chain anchor" : "MISMATCH"}</span>
            <TxLink hash={result.txHash} />
          </div>
          <div className="mt-3 space-y-1 break-all font-mono text-xs text-neutral-400">
            <div>expected: {result.expected || "—"}</div>
            <div>actual&nbsp;&nbsp;: {result.actual || "—"}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
