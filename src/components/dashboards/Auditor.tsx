"use client";

import { useMemo, useState } from "react";
import {
  Card, Stat, Table, Td, StatusBadge, Btn, TxLink, Field, inputClass, useApi, useToast,
} from "@/components/ui";
import { api } from "@/lib/client";

type Rec = {
  _id: string;
  serial: string;
  energyMwh: number;
  status: string;
  issueTxHash: string | null;
  contentHash: string | null;
  generationWindow: { from: string; to: string };
  backingReadingIds: string[];
  createdAt: string;
};
type Party = { name: string; email?: string; role?: string } | null;
type Provenance = {
  certificate: Rec & {
    generatorId: string; meterId: string; feederId: string;
    backingReadingKwh?: number[];
    creditsAwarded?: number;
    currentHolderId: string;
  };
  parties: {
    generator: Party;
    currentHolder: Party;
    meter: { code: string; solarCapacityKw: number } | null;
    feeder: { name: string; code: string } | null;
  };
  backingReadings: { _id: string; timestamp: string; exportKwh: number; generationKwh: number }[];
  transactions: { _id: string; action: string; anchorTxHash: string | null; timestamp: string }[];
  verification: { verified: boolean; expected: string; actual: string; txHash: string | null };
};

const NAV = [
  { id: "explorer", label: "REC Explorer" },
  { id: "verifier", label: "On-chain Verifier" },
] as const;
type View = (typeof NAV)[number]["id"];

const kwh = (mwh: number) => (mwh * 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS_FILTERS = ["all", "issued", "pending", "retired"] as const;

export default function AuditorDashboard() {
  const recs = useApi<Rec[]>("/api/rec", 8000);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("explorer");
  const [showExport, setShowExport] = useState(false);
  const prov = useApi<Provenance>(selected ? `/api/rec/${selected}/provenance` : null);
  const { show, node } = useToast();

  const list = recs.data ?? [];
  const issued = list.filter((r) => r.status === "issued").length;
  const revoked = list.filter((r) => r.status === "revoked").length;
  const anchored = list.filter((r) => r.issueTxHash).length;
  const certifiedMwh = list.reduce((s, r) => s + (r.status === "issued" ? r.energyMwh : 0), 0);

  return (
    <div className="space-y-6">
      {/* ── Page header + primary export action ─────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">Auditor console</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Trace any certificate to its meter readings, verify it against the chain, and export the evidence.
          </p>
        </div>
        <Btn onClick={() => setShowExport(true)}>
          <IconDownload /> <span className="ml-2">Export report</span>
        </Btn>
      </div>

      {/* ── Registry health at a glance ─────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="RECs in registry" value={recs.data ? list.length : "—"} />
        <Stat label="Certified" value={kwh(certifiedMwh)} unit="kWh" accent="leaf" />
        <Stat label="Anchored on-chain" value={recs.data ? anchored : "—"} accent="grid" />
        <Stat label="Revoked" value={recs.data ? revoked : "—"} accent="red" />
      </div>

      {/* ── 25% rail (nav + REC list) · 75% content ─────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_3fr] lg:items-start">
        <div className="space-y-4 lg:sticky lg:top-[68px]">
          <nav className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-sm lg:flex-col">
            {NAV.map((n) => {
              const on = view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    on ? "bg-leaf/10 text-leaf ring-1 ring-leaf/20" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
                  }`}
                >
                  {n.label}
                </button>
              );
            })}
          </nav>

          {view === "explorer" && (
            <Registry
              recs={list}
              loading={recs.loading && !recs.data}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </div>

        <div className="min-w-0">
          {view === "verifier" && <Verifier />}
          {view === "explorer" && (
            <>
              {!selected && <DetailPlaceholder count={list.length} />}
              {selected && prov.loading && !prov.data && <DetailSkeleton />}
              {selected && prov.data && <RecDetail prov={prov.data} />}
            </>
          )}
        </div>
      </div>

      {showExport && (
        <ExportModal recs={list} onClose={() => setShowExport(false)} toast={show} />
      )}
      {node}
    </div>
  );
}

// ─── Registry (searchable / filterable list) ────────────────────────────
function Registry({
  recs, loading, selected, onSelect,
}: {
  recs: Rec[]; loading: boolean; selected: string | null; onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return recs.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!needle || r.serial.toLowerCase().includes(needle)),
    );
  }, [recs, q, status]);

  return (
    <Card className="lg:sticky lg:top-[68px]">
      <div className="relative mb-3">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"><IconSearch /></span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search serial…"
          className={`${inputClass} pl-9`}
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize transition ${
              status === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="-mx-1 max-h-[560px] space-y-1 overflow-y-auto px-1">
        {loading && <p className="px-2 py-8 text-center text-sm text-neutral-400">Loading registry…</p>}
        {!loading && filtered.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-neutral-400">No RECs match.</p>
        )}
        {filtered.map((r) => {
          const on = selected === r._id;
          return (
            <button
              key={r._id}
              onClick={() => onSelect(r._id)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                on ? "border-leaf/40 bg-leaf/5 ring-1 ring-leaf/20" : "border-transparent hover:border-neutral-200 hover:bg-neutral-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs font-medium text-neutral-700">{r.serial}</span>
                <StatusBadge value={r.status} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
                <span className="tabular-nums">{kwh(r.energyMwh)} kWh</span>
                <span>·</span>
                <span>{fmtDay(r.createdAt)}</span>
                {r.issueTxHash && <span className="text-grid" title="Anchored on-chain">⛓</span>}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function DetailPlaceholder({ count }: { count: number }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white px-6 py-16 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400"><IconShield /></span>
      <p className="text-sm font-medium text-neutral-600">Select a certificate to audit</p>
      <p className="mt-1 max-w-xs text-xs text-neutral-400">
        {count} REC{count === 1 ? "" : "s"} in the registry. Open one to see its full record, on-chain verification and chain of custody.
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />
      <div className="h-56 animate-pulse rounded-xl bg-neutral-100" />
    </div>
  );
}

// ─── Full REC record ────────────────────────────────────────────────────
function RecDetail({ prov }: { prov: Provenance }) {
  const c = prov.certificate;
  const v = prov.verification;
  const backedKwh = (c.backingReadingKwh ?? []).reduce((s, n) => s + n, 0);

  return (
    <Card title="Certificate" actions={<StatusBadge value={c.status} />}>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-base font-semibold text-neutral-900">{c.serial}</span>
        <span className="text-sm text-neutral-400">
          {kwh(c.energyMwh)} kWh · issued {fmtDay(c.createdAt)}
        </span>
      </div>

      {/* Verification headline */}
      <div className={`flex items-center gap-4 rounded-xl border p-4 ${v.verified ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
        <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-full text-white ${v.verified ? "bg-leaf" : "bg-red-600"}`}>
          {v.verified ? <IconShieldCheck /> : <IconShieldAlert />}
        </span>
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${v.verified ? "text-green-800" : "text-red-800"}`}>
            {v.verified ? "Verified on-chain" : "Tamper detected — hash mismatch"}
          </div>
          <div className={`text-xs ${v.verified ? "text-green-700" : "text-red-700"}`}>
            {v.verified
              ? "The current record hashes exactly to its blockchain anchor."
              : "The current record does not match the hash anchored at issuance."}
          </div>
        </div>
        {c.status === "issued" && (
          <div className="ml-auto flex-none"><OnChainProof cert={c} verification={v} /></div>
        )}
      </div>

      {/* Details (left) + chain of custody (right), one integrated section */}
      <div className="mt-5 grid gap-6 lg:grid-cols-3">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:col-span-2">
          <Detail label="Generator" value={prov.parties.generator?.name ?? c.generatorId} sub={prov.parties.generator?.email} />
          <Detail label="Current holder" value={prov.parties.currentHolder?.name ?? c.currentHolderId} sub={prov.parties.currentHolder?.role} />
          <Detail label="Meter" value={prov.parties.meter?.code ?? c.meterId} sub={prov.parties.meter ? `${prov.parties.meter.solarCapacityKw} kW solar` : undefined} />
          <Detail label="Feeder" value={prov.parties.feeder ? `${prov.parties.feeder.name} (${prov.parties.feeder.code})` : c.feederId} />
          <Detail label="Energy certified" value={`${kwh(c.energyMwh)} kWh`} sub={`${c.energyMwh} MWh`} />
          <Detail label="Credits awarded" value={(c.creditsAwarded ?? 0).toLocaleString()} />
          <Detail
            label="Generation window"
            value={`${fmtDateTime(c.generationWindow.from)} → ${fmtDateTime(c.generationWindow.to)}`}
          />
          <Detail
            label="Backing readings"
            value={<BackingReadings readings={prov.backingReadings} reservedKwh={backedKwh} />}
          />
        </dl>

        <div className="border-t border-neutral-100 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-neutral-700">Chain of custody</h4>
            <span className="text-xs text-neutral-400">{prov.transactions.length} event{prov.transactions.length === 1 ? "" : "s"}</span>
          </div>
          {prov.transactions.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-400">No lifecycle events recorded.</p>
          ) : (
            <ol className="relative ml-2 space-y-5 border-l border-neutral-200 pl-6">
              {prov.transactions.map((t) => (
                <li key={t._id} className="relative">
                  <span
                    className="absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white"
                    style={{ backgroundColor: ACTION_COLOR[t.action] ?? "#a3a3a3" }}
                  />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium capitalize text-neutral-800">{ACTION_LABEL[t.action] ?? t.action}</span>
                    <TxLink hash={t.anchorTxHash} />
                    <span className="text-xs text-neutral-400">{new Date(t.timestamp).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}

// On-chain proof — opens the re-hash comparison + anchor references in a modal,
// triggered from a button on the verification banner.
function OnChainProof({
  cert, verification,
}: {
  cert: Provenance["certificate"];
  verification: Provenance["verification"];
}) {
  const [open, setOpen] = useState(false);
  const v = verification;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-neutral-700 shadow-sm backdrop-blur transition hover:bg-white"
      >
        <IconLink /> On-chain proof
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-800">On-chain proof</h3>
                <p className="mt-0.5 text-xs text-neutral-500">The record re-hashed and compared to its blockchain anchor.</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close"><IconClose /></button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${v.verified ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${v.verified ? "bg-leaf" : "bg-red-600"}`}>{v.verified ? <IconCheck /> : <IconShieldAlert />}</span>
                <span className="font-medium">{v.verified ? "Recomputed hash matches the anchor" : "Recomputed hash does not match the anchor"}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Issue tx</span>
                <TxLink hash={cert.issueTxHash} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Anchor tx</span>
                <TxLink hash={v.txHash} />
              </div>

              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Anchored hash (expected)</div>
                <code className="block break-all rounded-lg bg-neutral-50 p-2 font-mono text-xs text-neutral-600">{v.expected || cert.contentHash || "—"}</code>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Recomputed hash (actual)</div>
                <code className={`block break-all rounded-lg p-2 font-mono text-xs ${v.verified ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{v.actual || "—"}</code>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Backing readings open in a centred modal so the full generation evidence
// gets real screen space instead of a cramped dropdown.
function BackingReadings({
  readings, reservedKwh,
}: {
  readings: { _id: string; timestamp: string; exportKwh: number; generationKwh: number }[];
  reservedKwh: number;
}) {
  const [open, setOpen] = useState(false);
  const totalGen = readings.reduce((s, r) => s + r.generationKwh, 0);
  const totalExport = readings.reduce((s, r) => s + r.exportKwh, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
      >
        {readings.length} reading{readings.length === 1 ? "" : "s"}
        <IconExpand />
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-800">Generation evidence</h3>
                <p className="mt-0.5 text-xs text-neutral-500">
                  The metered readings this certificate is backed by.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close"><IconClose /></button>
            </div>

            <div className="grid grid-cols-3 gap-px border-b border-neutral-100 bg-neutral-100 text-center">
              <MiniStat label="Readings" value={String(readings.length)} />
              <MiniStat label="Generation" value={`${totalGen.toFixed(3)} kWh`} />
              <MiniStat label="Reserved" value={`${reservedKwh.toFixed(3)} kWh`} accent />
            </div>

            <div className="overflow-y-auto px-6 py-4">
              <Table head={["Timestamp", "Generation kWh", "Export kWh"]} rows={readings.length}>
                {readings.map((r) => (
                  <tr key={r._id}>
                    <Td className="text-xs text-neutral-500">{new Date(r.timestamp).toLocaleString()}</Td>
                    <Td className="tabular-nums">{r.generationKwh.toFixed(3)}</Td>
                    <Td className="tabular-nums text-leaf">{r.exportKwh.toFixed(3)}</Td>
                  </tr>
                ))}
              </Table>
            </div>

            <div className="flex items-center justify-between border-t border-neutral-100 px-6 py-3 text-xs text-neutral-400">
              <span>Total export <b className="text-neutral-600">{totalExport.toFixed(3)} kWh</b></span>
              <Btn size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${accent ? "text-leaf" : "text-neutral-800"}`}>{value}</div>
    </div>
  );
}

const ACTION_COLOR: Record<string, string> = {
  issue: "#38a169", transfer: "#2b6cb0", retire: "#a3a3a3", revoke: "#dc2626",
};
const ACTION_LABEL: Record<string, string> = {
  issue: "Issued & anchored", transfer: "Transferred", retire: "Retired", revoke: "Revoked",
};

function Detail({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-800">{value}</dd>
      {sub && <dd className="text-xs text-neutral-400">{sub}</dd>}
    </div>
  );
}

// ─── Export report modal (date presets + download + email) ──────────────
type Preset = { label: string; days: number | null };
const PRESETS: Preset[] = [
  { label: "All time", days: null },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function ExportModal({ recs, onClose, toast }: { recs: Rec[]; onClose: () => void; toast: (m: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [recipient, setRecipient] = useState("");
  const [emailing, setEmailing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inRange = useMemo(() => {
    const lo = from ? new Date(from).getTime() : -Infinity;
    const hi = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
    return recs.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= lo && t <= hi;
    });
  }, [recs, from, to]);
  const rangeMwh = inRange.reduce((s, r) => s + r.energyMwh, 0);

  function applyPreset(p: Preset) {
    if (p.days === null) { setFrom(""); setTo(""); return; }
    setFrom(ymd(daysAgo(p.days)));
    setTo(ymd(new Date()));
  }
  const activePreset = (p: Preset) => {
    if (p.days === null) return !from && !to;
    return from === ymd(daysAgo(p.days)) && to === ymd(new Date());
  };

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const reportUrl = (format: string) => `/api/audit/report?format=${format}${qs.toString() ? `&${qs}` : ""}`;

  async function emailReport() {
    setError(null);
    if (!recipient) { setError("Enter a recipient email address."); return; }
    setEmailing(true);
    try {
      const res = await api<{ recs: number; recipient: string }>("/api/audit/report/email", {
        method: "POST",
        body: { recipient, from: from || undefined, to: to || undefined },
      });
      toast(`Report (${res.recs} RECs) emailed to ${res.recipient}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmailing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">Export audit report</h3>
            <p className="mt-0.5 text-xs text-neutral-500">Consolidated, one row per REC — parties, generation window, credits, lifecycle & on-chain refs.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close"><IconClose /></button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <span className="mb-2 block text-xs font-medium text-neutral-500">Period (by issuance date)</span>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    activePreset(p) ? "bg-leaf text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} />
              </Field>
              <Field label="To">
                <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} />
              </Field>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-leaf/10 text-leaf"><IconCheck /></span>
            <span><b className="tabular-nums text-neutral-900">{inRange.length}</b> of {recs.length} RECs · <b className="tabular-nums text-neutral-900">{kwh(rangeMwh)}</b> kWh in range</span>
          </div>

          <div className="flex flex-wrap gap-3">
            <a href={reportUrl("csv")} className="inline-flex flex-1 items-center justify-center rounded-lg bg-leaf px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700">
              <IconDownload /> <span className="ml-2">Download CSV</span>
            </a>
            <a href={reportUrl("json")} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50">
              View JSON
            </a>
          </div>

          <div className="border-t border-neutral-100 pt-5">
            <span className="mb-2 block text-xs font-medium text-neutral-500">Or email it</span>
            <div className="flex items-end gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"><IconMail /></span>
                <input
                  type="email"
                  className={`${inputClass} pl-9`}
                  placeholder="auditor@example.org"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && emailReport()}
                />
              </div>
              <Btn onClick={emailReport} disabled={emailing || !recipient}>
                {emailing ? "Sending…" : "Send"}
              </Btn>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <p className="mt-2 text-xs text-neutral-400">Sends an HTML summary with the full CSV attached, scoped to the period above.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── On-chain verifier (by transaction hash) ────────────────────────────
type RecSubject = {
  kind: "rec"; id: string; serial: string; energyMwh: number; status: string; createdAt: string;
  generationWindow: { from: string; to: string }; creditsAwarded: number;
  generator: string | null; currentHolder: string | null;
  meter: { code: string; solarCapacityKw: number } | null; feeder: { name: string; code: string } | null;
  issueTxHash: string | null;
};
type TradeSubject = {
  kind: "trade"; id: string; quantityKwh: number; pricePerKwh: number; totalCredits: number;
  status: string; settledAt: string | null; createdAt: string;
  seller: string | null; buyer: string | null; feeder: { name: string; code: string } | null;
};
type VerifyResult = {
  txHash: string;
  refType: "rec" | "trade" | "rec_txn";
  refId: string;
  network: string;
  anchorStatus: string;
  contentHash: string;
  anchoredAt: string;
  hashMatch: { verified: boolean; expected: string; actual: string } | null;
  onChain: { found: boolean; calldataMatches: boolean | null; from: string | null; to: string | null; blockNumber: number | null };
  subject: RecSubject | TradeSubject | null;
};

const shortAddr = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

function Verifier() {
  const [tx, setTx] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setError(null); setResult(null); setBusy(true);
    try {
      const res = await fetch(`/api/verify/tx/${encodeURIComponent(tx.trim())}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "Failed");
      setResult(json.data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  // Verdict: prefer the re-hash check; otherwise fall back to the on-chain calldata match.
  const verified = result
    ? (result.hashMatch ? result.hashMatch.verified : !!(result.onChain.found && result.onChain.calldataMatches))
    : false;

  return (
    <Card title="On-chain verifier">
      <p className="mb-4 text-sm text-neutral-500">
        Paste an anchor transaction hash — we locate the record it anchored, re-hash it,
        cross-check the on-chain calldata, and show the certificate.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Transaction hash</span>
          <input
            className={`${inputClass} font-mono text-xs`}
            placeholder="0x…"
            value={tx}
            onChange={(e) => setTx(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tx.trim() && run()}
          />
        </label>
        <Btn onClick={run} disabled={!tx.trim() || busy}>{busy ? "Verifying…" : "Verify"}</Btn>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-4 space-y-4">
          {/* Verdict */}
          <div className={`flex items-center gap-3 rounded-xl border p-4 ${verified ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-white ${verified ? "bg-leaf" : "bg-red-600"}`}>
              {verified ? <IconShieldCheck /> : <IconShieldAlert />}
            </span>
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${verified ? "text-green-800" : "text-red-800"}`}>
                {verified ? "Verified against the blockchain anchor" : "Not verified — hash mismatch"}
              </div>
              <div className={`text-xs ${verified ? "text-green-700" : "text-red-700"}`}>
                {result.hashMatch
                  ? (verified ? "The record hashes exactly to what was anchored." : "The record no longer matches the anchored hash.")
                  : (result.onChain.found ? "Confirmed via on-chain calldata." : "Anchor found; hash not re-derivable for this ref type.")}
              </div>
            </div>
            <span className="ml-auto flex-none"><TxLink hash={result.txHash} /></span>
          </div>

          {/* On-chain proof */}
          <div className="grid gap-3 rounded-xl border border-neutral-200 p-4 sm:grid-cols-2">
            <ProofRow label="Network" value={result.network} />
            <ProofRow label="Block" value={result.onChain.blockNumber ? `#${result.onChain.blockNumber}` : "—"} />
            <ProofRow
              label="On-chain calldata"
              value={
                result.onChain.found
                  ? (result.onChain.calldataMatches ? "Matches anchored hash ✓" : "Does not match ✗")
                  : "Mock anchor (offline mode)"
              }
            />
            <ProofRow label="Anchor status" value={result.anchorStatus} />
            {result.onChain.found && (
              <ProofRow label="From → To" value={`${shortAddr(result.onChain.from)} → ${shortAddr(result.onChain.to)}`} mono />
            )}
            <ProofRow label="Ref" value={`${result.refType} · ${result.refId.slice(0, 8)}…`} mono />
          </div>

          {/* Certificate / record it anchored */}
          {result.subject?.kind === "rec" && <RecSubjectCard s={result.subject} />}
          {result.subject?.kind === "trade" && <TradeSubjectCard s={result.subject} />}

          {/* Hash comparison */}
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Anchored hash</div>
              <code className="block break-all rounded-lg bg-neutral-50 p-2 font-mono text-xs text-neutral-600">{result.contentHash || "—"}</code>
            </div>
            {result.hashMatch && (
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Recomputed hash</div>
                <code className={`block break-all rounded-lg p-2 font-mono text-xs ${result.hashMatch.verified ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{result.hashMatch.actual || "—"}</code>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function ProofRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</span>
      <span className={`text-neutral-800 ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</span>
    </div>
  );
}

function RecSubjectCard({ s }: { s: RecSubject }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf/10 text-leaf"><IconShield /></span>
        <span className="font-mono text-base font-semibold text-neutral-900">{s.serial}</span>
        <StatusBadge value={s.status} />
        <span className="ml-auto text-sm text-neutral-400">{kwh(s.energyMwh)} kWh</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Detail label="Generator" value={s.generator ?? "—"} />
        <Detail label="Current holder" value={s.currentHolder ?? "—"} />
        <Detail label="Meter" value={s.meter?.code ?? "—"} sub={s.meter ? `${s.meter.solarCapacityKw} kW solar` : undefined} />
        <Detail label="Feeder" value={s.feeder ? `${s.feeder.name} (${s.feeder.code})` : "—"} />
        <Detail label="Energy certified" value={`${kwh(s.energyMwh)} kWh`} sub={`${s.energyMwh} MWh`} />
        <Detail label="Credits awarded" value={(s.creditsAwarded ?? 0).toLocaleString()} />
        <Detail label="Generation window" value={`${fmtDateTime(s.generationWindow.from)} → ${fmtDateTime(s.generationWindow.to)}`} />
        <Detail label="Issued" value={fmtDay(s.createdAt)} />
      </dl>
    </div>
  );
}

function TradeSubjectCard({ s }: { s: TradeSubject }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-grid/10 text-grid"><IconLink /></span>
        <span className="text-base font-semibold text-neutral-900">Energy trade</span>
        <StatusBadge value={s.status} />
        <span className="ml-auto text-sm text-neutral-400">{s.quantityKwh} kWh</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Detail label="Seller" value={s.seller ?? "—"} />
        <Detail label="Buyer" value={s.buyer ?? "—"} />
        <Detail label="Quantity" value={`${s.quantityKwh} kWh`} />
        <Detail label="Price" value={`${s.pricePerKwh} cr/kWh`} />
        <Detail label="Total credits" value={`${s.totalCredits.toLocaleString()} cr`} />
        <Detail label="Feeder" value={s.feeder ? `${s.feeder.name} (${s.feeder.code})` : "—"} />
        <Detail label="Settled" value={s.settledAt ? fmtDateTime(s.settledAt) : "—"} />
      </dl>
    </div>
  );
}

// ─── date helpers ───────────────────────────────────────────────────────
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ─── inline icons (currentColor) ────────────────────────────────────────
function IconSearch() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
function IconDownload() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
}
function IconMail() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}
function IconClose() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>;
}
function IconCheck() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>;
}
function IconShield() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></svg>;
}
function IconShieldCheck() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>;
}
function IconShieldAlert() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M12 8v4m0 3h.01" /></svg>;
}
function IconExpand() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>;
}
function IconLink() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>;
}
