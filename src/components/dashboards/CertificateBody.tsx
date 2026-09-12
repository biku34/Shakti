"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import {
  Card, Stat, Table, Td, StatusBadge, Btn, TxLink, useApi, useToast,
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

const kwh = (mwh: number) => (mwh * 1000).toFixed(1);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function CertificateBodyDashboard() {
  const { show, node } = useToast();
  const queue = useApi<Rec[]>("/api/rec/issuance-queue", 5000);
  const registry = useApi<Rec[]>("/api/rec", 6000);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const evidence = useApi<Provenance>(evidenceId ? `/api/rec/${evidenceId}/provenance` : null);

  const pending = queue.data ?? [];
  const recs = registry.data ?? [];

  async function approve(id: string) {
    setApproving(id);
    try {
      const r = await api<{ alertsRaised: number; creditsAwarded: number }>(`/api/rec/${id}/approve`, { method: "POST" });
      const paid = `issued & anchored — ${r.creditsAwarded.toFixed(2)} cr paid to generator`;
      show(r.alertsRaised > 0 ? `REC ${paid}, but ${r.alertsRaised} fraud alert(s) raised!` : `REC ${paid}`);
      queue.refetch(); registry.refetch();
    } catch (e) { show(e instanceof Error ? e.message : "Failed"); }
    finally { setApproving(null); }
  }

  async function revoke(id: string) {
    if (!window.confirm("Reject this REC request? It will be revoked and the held surplus released back to the generator.")) return;
    try {
      await api(`/api/rec/${id}/revoke`, { method: "POST" });
      show("REC request revoked — held surplus released");
      queue.refetch(); registry.refetch();
    } catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Pending approval" value={queue.data ? pending.length : "—"} accent="solar" />
        <Stat label="Issued" value={recs.filter((r) => r.status === "issued").length} accent="leaf" />
        <Stat label="Revoked" value={recs.filter((r) => r.status === "revoked").length} accent="red" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* ── Issuance queue — the primary action lane ─────────────────── */}
        <Card
          title="Issuance queue"
          actions={<span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{pending.length} pending</span>}
        >
          {pending.length === 0 ? (
            <EmptyState
              title="Queue is clear"
              body="New REC requests from prosumers will appear here for review and approval."
            />
          ) : (
            <ul className="space-y-3">
              {pending.map((r) => (
                <li key={r._id} className="rounded-xl border border-neutral-200 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs text-neutral-500">{r.serial}</div>
                      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-neutral-900">
                        {kwh(r.energyMwh)} <span className="text-sm font-normal text-neutral-400">kWh</span>
                      </div>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">pending</span>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
                    <span>Generation window <b className="font-medium text-neutral-700">{fmtDate(r.generationWindow.from)} – {fmtDate(r.generationWindow.to)}</b></span>
                    <span>Backed by <b className="font-medium text-neutral-700">{r.backingReadingIds.length} readings</b></span>
                  </div>
                  <div className="flex gap-2 [&>button]:flex-1">
                    <Btn size="sm" variant="ghost" onClick={() => setEvidenceId(r._id)}>Evidence</Btn>
                    <Btn size="sm" variant="danger" onClick={() => revoke(r._id)}>Revoke</Btn>
                    <Btn size="sm" disabled={approving === r._id} onClick={() => approve(r._id)}>
                      {approving === r._id ? "Anchoring…" : "Approve"}
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── REC registry — the record of every certificate ──────────── */}
        <Card
          title="REC registry"
          actions={<span className="text-xs text-neutral-400">{recs.length} total</span>}
        >
          {recs.length === 0 ? (
            <EmptyState title="No certificates yet" body="Approved RECs are anchored on-chain and listed here." />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {recs.map((r) => (
                <li key={r._id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-neutral-600">{r.serial}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
                      <span className="tabular-nums">{kwh(r.energyMwh)} kWh</span>
                      {r.issueTxHash && <><span>·</span><TxLink hash={r.issueTxHash} /></>}
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <StatusBadge value={r.status} />
                    <Btn size="sm" variant="ghost" onClick={() => setEvidenceId(r._id)}>Evidence</Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {evidenceId && (
        <EvidenceModal prov={evidence.data ?? null} onClose={() => setEvidenceId(null)} />
      )}
      {node}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-10 text-center">
      <p className="text-sm font-medium text-neutral-500">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-neutral-400">{body}</p>
    </div>
  );
}

// Inline provenance viewer — the backing readings that justify a certificate.
function EvidenceModal({ prov, onClose }: { prov: Provenance | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-700">Generation evidence</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!prov && <p className="py-10 text-center text-sm text-neutral-400">Loading evidence…</p>}

        {prov && (
          <>
            <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${prov.verification.verified ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
              <StatusBadge value={prov.verification.verified ? "issued" : "failed"} />
              <span>{prov.verification.verified ? "Hash matches on-chain anchor" : "Not yet anchored / hash mismatch"}</span>
            </div>
            <div className="mb-4 grid gap-4 sm:grid-cols-3">
              <Stat label="Serial" value={<span className="font-mono text-sm">{prov.certificate.serial}</span>} />
              <Stat label="Claimed" value={kwh(prov.certificate.energyMwh)} unit="kWh" />
              <Stat label="Backing export" value={prov.backingReadings.reduce((s, r) => s + r.exportKwh, 0).toFixed(3)} unit="kWh" accent="leaf" />
            </div>
            <Table head={["Timestamp", "Generation kWh", "Export kWh", "Verified"]} rows={prov.backingReadings.length}>
              {prov.backingReadings.map((r) => (
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
      </div>
    </div>
  );
}
