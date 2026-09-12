"use client";

import { useId, useState } from "react";
import { api } from "@/lib/client";
import {
  Card, Stat, Table, Td, StatusBadge, Tabs, Btn, TxLink, inputClass, useApi, useToast,
} from "@/components/ui";

type Market = {
  settledTrades: number;
  tradedEnergyKwh: number;
  tradedCredits: number;
  recsByStatus: Record<string, number>;
  alertsByStatus: Record<string, number>;
};
type Alert = {
  _id: string; type: string; severity: string; subjectType: string; subjectId: string;
  ruleId: string; evidence: Record<string, unknown>; status: string; createdAt: string;
};
type FeederCtl = {
  _id: string; code: string; name: string; congestionLevel: string;
  clearingPrice: number | null;
  priceFloorPerKwh: number | null; priceCeilingPerKwh: number | null;
  effectiveFloor: number; effectiveCeiling: number;
  tradingSuspendedUntil: string | null; suspended: boolean;
};
type TradeRow = {
  _id: string; feederCode: string; sellerName: string; buyerName: string;
  quantityKwh: number; pricePerKwh: number; totalCredits: number;
  status: string; anchorTxHash: string | null; flagged: boolean; flagReason: string | null;
  createdAt: string; settledAt: string | null;
};

const TABS = [
  { id: "market", label: "Market Overview" },
  { id: "fraud", label: "Fraud Dashboard" },
  { id: "compliance", label: "Compliance Reports" },
];

const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export default function RegulatorDashboard() {
  const { show, node } = useToast();
  const market = useApi<Market>("/api/reports/market", 6000);
  const alerts = useApi<Alert[]>("/api/fraud/alerts", 4000);
  const feeders = useApi<FeederCtl[]>("/api/regulator/feeders", 5000);
  const trades = useApi<TradeRow[]>("/api/reports/trades", 6000);
  const m = market.data;

  const feederList = feeders.data ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const selectedFeeder = feederList.find((f) => f._id === selId) ?? feederList[0] ?? null;

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
  const [aiBusy, setAiBusy] = useState(false);
  async function aiScan() {
    setAiBusy(true);
    try {
      const r = await api<{ usedAI: boolean; reason?: string; model?: string; findings: number; alertsRaised: number }>("/api/fraud/ai-scan", { method: "POST" });
      if (!r.usedAI) show(r.reason ?? "AI review not configured");
      else if (r.alertsRaised > 0) show(`AI review — ${r.alertsRaised} new alert(s) raised`);
      else if (r.findings > 0) show(`AI review — ${r.findings} finding(s), all already flagged`);
      else show("AI review — no new anomalies detected");
      alerts.refetch();
    } catch (e) { show(e instanceof Error ? e.message : "AI review failed"); }
    finally { setAiBusy(false); }
  }
  async function flagTrade(t: TradeRow) {
    try {
      if (!t.flagged) {
        const reason = window.prompt("Reason for flagging this transaction (optional):", "");
        if (reason === null) return; // cancelled
        await api(`/api/trades/${t._id}/flag`, { method: "POST", body: { flagged: true, reason: reason || undefined } });
        show("Transaction flagged for review");
      } else {
        await api(`/api/trades/${t._id}/flag`, { method: "POST", body: { flagged: false } });
        show("Flag cleared");
      }
      trades.refetch();
    } catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }

  const openAlerts = (alerts.data ?? []).filter((a) => ["open", "investigating"].includes(a.status));
  const flaggedCount = (trades.data ?? []).filter((t) => t.flagged).length;

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

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neutral-700">Feeder market controls</h3>
                  <span className="hidden text-xs text-neutral-400 sm:inline">Live clearing price · regulated price band · trading suspension</span>
                </div>
                {feederList.length === 0 ? (
                  <Card><p className="text-sm text-neutral-400">No feeders.</p></Card>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[248px_1fr] lg:items-start">
                    <FeederRail feeders={feederList} selectedId={selectedFeeder?._id ?? null} onSelect={setSelId} />
                    {selectedFeeder && (
                      <FeederTerminal
                        key={selectedFeeder._id}
                        f={selectedFeeder}
                        onDone={(msg) => { show(msg); feeders.refetch(); }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {active === "fraud" && (
            <AlertsPanel
              alerts={alerts.data ?? []}
              loading={alerts.loading && !alerts.data}
              onStatus={setStatus}
              onRevoke={revoke}
              onScan={scan}
              onAiScan={aiScan}
              aiBusy={aiBusy}
            />
          )}

          {active === "compliance" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-4">
                <Stat label="Total transactions" value={trades.data?.length ?? "—"} />
                <Stat label="Flagged" value={flaggedCount} accent={flaggedCount ? "red" : "leaf"} />
                <Stat label="Confirmed frauds" value={m?.alertsByStatus?.confirmed ?? 0} accent="red" />
                <Stat label="Revoked RECs" value={m?.recsByStatus?.revoked ?? 0} accent="red" />
              </div>

              <Card
                title="Transaction ledger"
                actions={<span className="text-xs text-neutral-400">Flag any settled trade to place a compliance hold</span>}
              >
                <Table
                  head={["Time", "Feeder", "Seller → Buyer", "kWh", "Price", "Credits", "Status", "Chain", "Compliance"]}
                  rows={trades.data?.length ?? 0}
                  empty="No trades yet."
                >
                  {trades.data?.map((t) => (
                    <tr key={t._id} className={t.flagged ? "bg-red-50" : ""}>
                      <Td className="whitespace-nowrap text-xs text-neutral-500">{fmtTime(t.createdAt)}</Td>
                      <Td className="font-mono text-xs">{t.feederCode}</Td>
                      <Td className="text-xs">{t.sellerName} <span className="text-neutral-400">→</span> {t.buyerName}</Td>
                      <Td className="tabular-nums">{t.quantityKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums">{t.pricePerKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums">{t.totalCredits.toFixed(2)}</Td>
                      <Td><StatusBadge value={t.status} /></Td>
                      <Td><TxLink hash={t.anchorTxHash} /></Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          {t.flagged && <span title={t.flagReason ?? ""}><StatusBadge value="flagged" /></span>}
                          <Btn size="sm" variant={t.flagged ? "ghost" : "danger"} onClick={() => flagTrade(t)}>
                            {t.flagged ? "Unflag" : "Flag"}
                          </Btn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          )}
          {node}
        </>
      )}
    </Tabs>
  );
}

const SUSPEND_DURATIONS = [
  { val: "15", label: "15m" },
  { val: "30", label: "30m" },
  { val: "60", label: "1h" },
  { val: "120", label: "2h" },
];

// Human "resumes in" string from an ISO suspension expiry, or null if elapsed.
function remainingLabel(untilIso: string | null): string | null {
  if (!untilIso) return null;
  const ms = new Date(untilIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

const CONGESTION_DOT: Record<string, string> = {
  low: "bg-green-500", risky: "bg-amber-500", high: "bg-red-500", critical: "bg-red-700",
};

// ─── Left rail: selectable feeder list (the "watchlist") ────────────────
function FeederRail({
  feeders, selectedId, onSelect,
}: {
  feeders: FeederCtl[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <aside className="self-start rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm lg:sticky lg:top-[68px]">
      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        Feeders <span className="text-neutral-300">· {feeders.length}</span>
      </div>
      <div className="space-y-1">
        {feeders.map((f) => {
          const on = f._id === selectedId;
          const dot = f.suspended ? "bg-red-500" : CONGESTION_DOT[f.congestionLevel] ?? "bg-neutral-300";
          return (
            <button
              key={f._id}
              onClick={() => onSelect(f._id)}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                on ? "bg-neutral-900" : "hover:bg-neutral-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`font-mono text-[11px] ${on ? "text-neutral-400" : "text-neutral-400"}`}>{f.code}</span>
                <span className={`h-2 w-2 flex-none rounded-full ${dot}`} title={f.suspended ? "Suspended" : f.congestionLevel} />
              </div>
              <div className={`mt-0.5 truncate text-sm font-medium ${on ? "text-white" : "text-neutral-800"}`}>{f.name}</div>
              <div className={`mt-0.5 tabular-nums text-xs ${on ? "text-neutral-300" : "text-neutral-400"}`}>
                {f.clearingPrice != null ? `${f.clearingPrice.toFixed(2)} cr/kWh` : "— cr/kWh"}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ─── Center terminal: price chart with regulated band + control toolbar ──
function FeederTerminal({ f, onDone }: { f: FeederCtl; onDone: (msg: string) => void }) {
  const hist = useApi<{ points: { t: string; price: number }[] }>(
    `/api/feeders/${f._id}/price-history?points=80`, 5000,
  );
  const [floor, setFloor] = useState(f.priceFloorPerKwh?.toString() ?? "");
  const [ceiling, setCeiling] = useState(f.priceCeilingPerKwh?.toString() ?? "");
  const [mins, setMins] = useState("30");
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await api(`/api/feeders/${f._id}/controls`, { method: "POST", body }); onDone(msg); }
    catch (e) { onDone(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  const saveBand = () => post(
    { priceFloorPerKwh: floor === "" ? null : Number(floor), priceCeilingPerKwh: ceiling === "" ? null : Number(ceiling) },
    `${f.code} price band updated`,
  );

  const pts = hist.data?.points ?? [];
  const price = f.clearingPrice;
  const resumesIn = remainingLabel(f.tradingSuspendedUntil);

  return (
    <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      {/* Header: identity + live clearing price */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-400">{f.code}</span>
            <StatusBadge value={f.congestionLevel} />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                f.suspended ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${f.suspended ? "bg-red-500" : "animate-pulse bg-green-500"}`} />
              {f.suspended ? "Suspended" : "Trading"}
            </span>
          </div>
          <h3 className="mt-1 truncate text-lg font-semibold text-neutral-900">{f.name}</h3>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Clearing price</div>
          <div className="mt-0.5 flex items-baseline justify-end gap-1">
            <span className="text-3xl font-bold tabular-nums text-neutral-900">{price != null ? price.toFixed(2) : "—"}</span>
            <span className="text-xs text-neutral-400">cr/kWh</span>
          </div>
        </div>
      </div>

      {/* Price chart with the regulator's threshold band */}
      <div className="mt-4">
        {pts.length < 2 ? (
          <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-neutral-200 text-sm text-neutral-400">
            Waiting for price history on this feeder…
          </div>
        ) : (
          <PriceBandChart points={pts} floor={f.effectiveFloor} ceiling={f.effectiveCeiling} />
        )}
      </div>

      {/* Control toolbar */}
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4 border-t border-neutral-100 pt-4">
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Regulated price band · cr/kWh
          </div>
          <div className="flex items-center gap-2">
            <input
              className={`${inputClass} w-24 px-2.5 py-1.5 text-center text-sm tabular-nums`}
              type="number" step="0.1" min="0" placeholder="lower cap"
              value={floor} onChange={(e) => setFloor(e.target.value)}
            />
            <span className="text-neutral-300">–</span>
            <input
              className={`${inputClass} w-24 px-2.5 py-1.5 text-center text-sm tabular-nums`}
              type="number" step="0.1" min="0" placeholder="upper cap"
              value={ceiling} onChange={(e) => setCeiling(e.target.value)}
            />
            <Btn size="sm" disabled={busy} onClick={saveBand}>Set band</Btn>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Trading suspension
          </div>
          {f.suspended ? (
            <div className="flex items-center gap-3 rounded-lg bg-red-50 px-3 py-1.5">
              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                <span className="font-semibold text-red-700">Suspended</span>
                {resumesIn && <span className="text-red-500">· resumes in {resumesIn}</span>}
              </span>
              <Btn size="sm" variant="ghost" disabled={busy} onClick={() => post({ suspendMinutes: 0 }, `${f.code} trading resumed`)}>
                Resume
              </Btn>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
                {SUSPEND_DURATIONS.map((d) => (
                  <button
                    key={d.val}
                    type="button"
                    onClick={() => setMins(d.val)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      mins === d.val ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <Btn size="sm" variant="danger" disabled={busy} onClick={() => post({ suspendMinutes: Number(mins) }, `${f.code} trading suspended for ${mins} min`)}>
                Suspend
              </Btn>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Fraud alerting console ─────────────────────────────────────────────
const SEVERITY: Record<string, { bar: string; chip: string; dot: string }> = {
  critical: { bar: "border-l-red-600", chip: "bg-red-100 text-red-800", dot: "bg-red-600" },
  high: { bar: "border-l-orange-500", chip: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  medium: { bar: "border-l-amber-500", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  risky: { bar: "border-l-orange-500", chip: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  low: { bar: "border-l-blue-400", chip: "bg-blue-100 text-blue-800", dot: "bg-blue-400" },
};
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, risky: 3, medium: 2, low: 1 };
const ALERT_FILTERS = ["all", "open", "investigating", "confirmed", "dismissed"] as const;

const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function evidencePairs(ev: Record<string, unknown>): [string, string][] {
  return Object.entries(ev ?? {}).slice(0, 6).map(([k, v]) => {
    const val = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
    return [titleCase(k), val];
  });
}

function AlertsPanel({
  alerts, loading, onStatus, onRevoke, onScan, onAiScan, aiBusy,
}: {
  alerts: Alert[]; loading: boolean;
  onStatus: (id: string, status: string) => void;
  onRevoke: (subjectId: string) => void;
  onScan: () => void;
  onAiScan: () => void;
  aiBusy: boolean;
}) {
  const [filter, setFilter] = useState<(typeof ALERT_FILTERS)[number]>("all");

  const open = alerts.filter((a) => ["open", "investigating"].includes(a.status));
  const sevCount = (s: string) => open.filter((a) => (a.severity === s) || (s === "high" && a.severity === "risky")).length;

  const filtered = alerts
    .filter((a) => filter === "all" || a.status === filter)
    .sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || +new Date(b.createdAt) - +new Date(a.createdAt));

  const statusCount = (s: string) => (s === "all" ? alerts.length : alerts.filter((a) => a.status === s).length);

  return (
    <div className="space-y-5">
      {/* Severity summary + scan */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums ${open.length ? "text-red-600" : "text-green-600"}`}>{open.length}</span>
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">open</span>
          </div>
          <span className="mx-1 h-8 w-px bg-neutral-200" />
          {(["critical", "high", "medium"] as const).map((s) => (
            <span key={s} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${sevCount(s) ? SEVERITY[s].chip : "bg-neutral-100 text-neutral-400"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${sevCount(s) ? SEVERITY[s].dot : "bg-neutral-300"}`} />
              {sevCount(s)} {titleCase(s)}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="ghost" disabled={aiBusy} onClick={onAiScan}>
            <span className="mr-1">✨</span>{aiBusy ? "Reviewing…" : "AI review"}
          </Btn>
          <Btn size="sm" onClick={onScan}><IconRadar /><span className="ml-1.5">Run full scan</span></Btn>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-1.5">
        {ALERT_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
              filter === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
            }`}
          >
            {s} <span className={filter === s ? "text-neutral-400" : "text-neutral-400"}>· {statusCount(s)}</span>
          </button>
        ))}
      </div>

      {/* Alert list */}
      {loading ? (
        <div className="rounded-2xl border border-neutral-200 bg-white py-12 text-center text-sm text-neutral-400 shadow-sm">Loading alerts…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-white py-12 text-center shadow-sm">
          <div className="text-sm font-medium text-neutral-600">No {filter === "all" ? "" : filter} alerts</div>
          <p className="mt-1 text-xs text-neutral-400">Inject a fault from the simulator to raise one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <AlertCard key={a._id} a={a} onStatus={onStatus} onRevoke={onRevoke} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({
  a, onStatus, onRevoke,
}: {
  a: Alert; onStatus: (id: string, status: string) => void; onRevoke: (subjectId: string) => void;
}) {
  const sev = SEVERITY[a.severity] ?? SEVERITY.low;
  const resolved = ["confirmed", "dismissed"].includes(a.status);
  const pairs = evidencePairs(a.evidence);

  return (
    <div className={`rounded-xl border border-l-4 border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow-md ${sev.bar} ${resolved ? "opacity-75" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${sev.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />{a.severity}
            </span>
            <h4 className="truncate text-sm font-semibold text-neutral-900">{titleCase(a.type)}</h4>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">{a.ruleId}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
            <span className="capitalize">{a.subjectType}</span>
            <span className="font-mono text-neutral-400">{a.subjectId.slice(-8)}</span>
            <span className="text-neutral-300">·</span>
            <span>{fmtTime(a.createdAt)}</span>
          </div>
        </div>
        <StatusBadge value={a.status} />
      </div>

      {pairs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pairs.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-md bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-100">
              <span className="text-neutral-400">{k}</span>
              <span className="font-semibold tabular-nums text-neutral-800">{v}</span>
            </span>
          ))}
        </div>
      )}

      {!resolved && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
          {a.status === "open" && (
            <Btn size="sm" variant="ghost" onClick={() => onStatus(a._id, "investigating")}>Investigate</Btn>
          )}
          <Btn size="sm" variant="danger" onClick={() => onStatus(a._id, "confirmed")}>Confirm fraud</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onStatus(a._id, "dismissed")}>Dismiss</Btn>
        </div>
      )}
      {a.subjectType === "rec" && a.status === "confirmed" && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2">
          <span className="text-xs font-medium text-red-700">Fraud confirmed — the backing REC can be revoked on-chain.</span>
          <Btn size="sm" variant="danger" onClick={() => onRevoke(a.subjectId)}>Revoke REC</Btn>
        </div>
      )}
    </div>
  );
}

function IconRadar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19.07 4.93A10 10 0 1 0 22 12" /><path d="M12 12 2 12" opacity="0" /><path d="M12 12l6-6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}

// ─── Price chart with the regulator's threshold band overlaid ───────────
function PriceBandChart({
  points, floor, ceiling, height = 300,
}: {
  points: { t: string; price: number }[]; floor: number; ceiling: number; height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const W = 760, H = height, padL = 40, padR = 54, padT = 16, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const prices = points.map((p) => p.price);
  const n = points.length;
  let yMin = Math.min(floor, ...prices);
  let yMax = Math.max(ceiling, ...prices);
  const padY = (yMax - yMin) * 0.12 || 1;
  yMin -= padY; yMax += padY;

  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const line = prices.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaP = `${line} L${x(n - 1).toFixed(1)},${y(yMin).toFixed(1)} L${x(0).toFixed(1)},${y(yMin).toFixed(1)} Z`;
  const last = prices[prices.length - 1];
  const lastOut = last != null && (last < floor || last > ceiling);
  const priceColor = "#4f46e5";

  const gridVals = [0, 0.5, 1].map((f) => yMin + f * (yMax - yMin));
  const labelIdx = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];

  return (
    <div className="w-full overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50/60 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        <defs>
          <linearGradient id={`pg-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={priceColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={priceColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Regulated band: shaded allowed zone between floor and ceiling */}
        <rect
          x={padL} width={plotW} y={y(ceiling)} height={Math.max(0, y(floor) - y(ceiling))}
          fill="#16a34a" fillOpacity="0.07"
        />
        {[{ v: ceiling, label: "Ceiling" }, { v: floor, label: "Floor" }].map((b) => (
          <g key={b.label}>
            <line x1={padL} x2={padL + plotW} y1={y(b.v)} y2={y(b.v)} stroke="#16a34a" strokeWidth={1} strokeDasharray="4 3" strokeOpacity="0.5" />
            <text x={padL + plotW + 6} y={y(b.v) + 3} fontSize="10" fill="#16a34a" fontWeight="600">{b.v}</text>
            <text x={padL + plotW + 6} y={y(b.v) - 7} fontSize="8" fill="#9ca3af">{b.label}</text>
          </g>
        ))}

        {/* faint gridlines + y labels */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} stroke="#f0efed" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#a8a29e">{v.toFixed(1)}</text>
          </g>
        ))}

        {/* price area + line */}
        <path d={areaP} fill={`url(#pg-${uid})`} />
        <path d={line} fill="none" stroke={priceColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last != null && (
          <circle cx={x(n - 1)} cy={y(last)} r={4} fill={lastOut ? "#dc2626" : priceColor} stroke="#fff" strokeWidth={1.5} />
        )}

        {/* x time labels */}
        {labelIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10" fill="#a8a29e">
            {hhmm(points[i].t)}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-2 pb-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: priceColor }} />
          <span className="text-neutral-500">Clearing price</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm bg-green-500/20" />
          <span className="text-neutral-500">Regulated band {floor}–{ceiling}</span>
        </span>
        {lastOut && <span className="font-medium text-red-500">⚠ Price outside band</span>}
      </div>
    </div>
  );
}
