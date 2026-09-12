"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  Card, Stat, Table, Td, StatusBadge, Btn, TxLink, useApi, useToast,
} from "@/components/ui";

type RecAiReview = { state: string; severity?: string | null; reason?: string | null; model?: string | null; checkedAt?: string | null };
type Rec = {
  _id: string;
  serial: string;
  energyMwh: number;
  status: string;
  issueTxHash: string | null;
  generationWindow: { from: string; to: string };
  backingReadingIds: string[];
  aiReview?: RecAiReview;
};
type Provenance = {
  certificate: Rec;
  backingReadings: { _id: string; timestamp: string; exportKwh: number; generationKwh: number; verified: boolean }[];
  verification: { verified: boolean; expected: string; actual: string; txHash: string | null };
};
type AiFinding = { type: string; severity: string; ruleId: string; rationale: string; confidence?: number };
type AiReview = { usedAI: boolean; reason?: string; model?: string; findings: AiFinding[] };

const kwh = (mwh: number) => (mwh * 1000).toFixed(1);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function CertificateBodyDashboard() {
  const { show, node } = useToast();
  const queue = useApi<Rec[]>("/api/rec/issuance-queue", 5000);
  const registry = useApi<Rec[]>("/api/rec", 6000);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const scannedRef = useRef(false);
  const evidence = useApi<Provenance>(evidenceId ? `/api/rec/${evidenceId}/provenance` : null);

  // Auto AI-scan the registry: check RECs not yet reviewed (capped server-side),
  // then refresh so flags appear inline. Runs once per load; re-scan via button.
  const scanRegistry = useCallback(async (all: boolean) => {
    setScanBusy(true);
    try {
      const r = await api<{ scanned: number; flagged: number }>("/api/rec/registry/ai-scan", { method: "POST", body: all ? { all: true } : {} });
      if (r.scanned > 0) { registry.refetch(); if (r.flagged > 0) show(`AI registry scan — ${r.flagged} REC(s) flagged`); }
      else if (all) show("AI registry scan — all RECs already checked");
    } catch (e) { show(e instanceof Error ? e.message : "Scan failed"); }
    finally { setScanBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scannedRef.current || !registry.data) return;
    const hasUnchecked = registry.data.some((r) => !r.aiReview || r.aiReview.state === "unchecked");
    if (hasUnchecked) { scannedRef.current = true; scanRegistry(false); }
  }, [registry.data, scanRegistry]);

  const pending = queue.data ?? [];
  const recs = registry.data ?? [];

  // AI evidence reviews, prefetched per pending REC so the modal opens instantly.
  // Un-anchored queue RECs have no on-chain hash to verify, so Groq scans their
  // backing readings in the background as soon as the queue loads.
  const [aiReviews, setAiReviews] = useState<Record<string, AiReview>>({});
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const reviewRec = useCallback(async (id: string) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setAiBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await api<AiReview>(`/api/rec/${id}/ai-review`, { method: "POST" });
      setAiReviews((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setAiReviews((m) => ({ ...m, [id]: { usedAI: false, reason: e instanceof Error ? e.message : "AI review failed", findings: [] } }));
    } finally {
      inFlight.current.delete(id);
      setAiBusy((b) => ({ ...b, [id]: false }));
    }
  }, []);

  // Prefetch reviews for the first few pending RECs (capped to bound Groq usage);
  // the rest review lazily when their evidence modal is opened. Guarded so the
  // queue's 5s poll never re-triggers a completed review.
  const PREFETCH_LIMIT = 2;
  useEffect(() => {
    for (const r of pending.slice(0, PREFETCH_LIMIT)) {
      if (!aiReviews[r._id] && !inFlight.current.has(r._id)) reviewRec(r._id);
    }
  }, [pending, aiReviews, reviewRec]);

  async function approve(id: string) {
    setApproving(id);
    try {
      const r = await api<{ alertsRaised: number }>(`/api/rec/${id}/approve`, { method: "POST" });
      const msg = "REC issued & anchored on-chain — generator can now list it for sale";
      show(r.alertsRaised > 0 ? `${msg}, but ${r.alertsRaised} fraud alert(s) raised!` : msg);
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
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">{recs.length} total</span>
              <Btn size="sm" variant="ghost" disabled={scanBusy} onClick={() => scanRegistry(true)}>
                {scanBusy ? "Scanning…" : "AI scan"}
              </Btn>
            </div>
          }
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
                    <AiFlagBadge review={r.aiReview} />
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
        <EvidenceModal
          prov={evidence.data ?? null}
          review={aiReviews[evidenceId] ?? null}
          busy={!!aiBusy[evidenceId]}
          onRerun={() => reviewRec(evidenceId)}
          onClose={() => setEvidenceId(null)}
        />
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
// The AI review is prefetched by the dashboard and passed in, so the modal opens
// instantly; `onRerun` is a fallback for the rare case it wasn't prefetched yet.
function EvidenceModal({
  prov, review, busy, onRerun, onClose,
}: {
  prov: Provenance | null;
  review: AiReview | null;
  busy: boolean;
  onRerun: () => void;
  onClose: () => void;
}) {
  const anchored = !!prov?.verification.txHash;

  useEffect(() => {
    if (prov && !anchored && !review && !busy) onRerun();
  }, [prov, anchored, review, busy, onRerun]);

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
            {anchored ? (
              <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${prov.verification.verified ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
                <StatusBadge value={prov.verification.verified ? "issued" : "failed"} />
                <span>{prov.verification.verified ? "Hash matches on-chain anchor" : "Hash mismatch — record differs from its anchor"}</span>
                <span className="ml-auto"><TxLink hash={prov.verification.txHash!} /></span>
              </div>
            ) : (
              <AiEvidencePanel review={review} busy={busy} onRerun={onRerun} />
            )}
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

const SEV_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-neutral-100 text-neutral-600",
};

// AI evidence review shown in place of the hash check while a REC is un-anchored.
function AiEvidencePanel({ review, busy, onRerun }: { review: AiReview | null; busy: boolean; onRerun: () => void }) {
  const findings = review?.findings ?? [];
  const clean = review?.usedAI && findings.length === 0;

  return (
    <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">AI</span>
        <span className="text-sm font-medium text-neutral-700">
          Not yet anchored — evidence reviewed by AI
        </span>
        <button
          type="button"
          onClick={onRerun}
          disabled={busy}
          className="ml-auto rounded px-2 py-0.5 text-xs text-neutral-500 transition hover:bg-neutral-200 disabled:opacity-50"
        >
          {busy ? "Reviewing…" : "Re-check"}
        </button>
      </div>

      {busy && <p className="mt-2 text-xs text-neutral-400">Analysing backing readings with Groq…</p>}

      {!busy && review && !review.usedAI && (
        <p className="mt-2 text-xs text-neutral-500">{review.reason ?? "AI review unavailable."}</p>
      )}

      {!busy && clean && (
        <p className="mt-2 flex items-center gap-2 text-xs text-green-700">
          <StatusBadge value="issued" /> No anomalies found in the backing evidence
          {review?.model && <span className="text-neutral-400">· {review.model}</span>}
        </p>
      )}

      {!busy && findings.length > 0 && (
        <ul className="mt-2 space-y-2">
          {findings.map((f, i) => (
            <li key={i} className="rounded-md border border-neutral-200 bg-white p-2">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_STYLES[f.severity] ?? SEV_STYLES.low}`}>
                  {f.severity}
                </span>
                <span className="font-mono text-[10px] text-neutral-500">{f.ruleId}</span>
                {typeof f.confidence === "number" && (
                  <span className="ml-auto text-[10px] text-neutral-400">{Math.round(f.confidence * 100)}% conf.</span>
                )}
              </div>
              <p className="mt-1 text-xs text-neutral-700">{f.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Inline AI anomaly flag — shown ONLY when a REC is flagged (no placeholder for
// clean / unchecked / error rows, to keep the registry uncluttered).
function AiFlagBadge({ review }: { review?: RecAiReview }) {
  if (review?.state !== "flagged") return null;
  return (
    <span
      title={review?.reason ?? "AI flagged an anomaly"}
      className="cursor-help rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800"
    >
      ⚠ AI {review?.severity ?? "flag"}
    </span>
  );
}
