"use client";

import { useState } from "react";
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

export default function RegulatorDashboard() {
  const { show, node } = useToast();
  const market = useApi<Market>("/api/reports/market", 6000);
  const alerts = useApi<Alert[]>("/api/fraud/alerts", 4000);
  const feeders = useApi<FeederCtl[]>("/api/regulator/feeders", 5000);
  const trades = useApi<TradeRow[]>("/api/reports/trades", 6000);
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
                  <span className="text-xs text-neutral-400">Live clearing price · regulated price band · trading suspension</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(feeders.data ?? []).map((f) => (
                    <FeederControlCard key={f._id} f={f} onDone={(msg) => { show(msg); feeders.refetch(); }} />
                  ))}
                  {feeders.data && feeders.data.length === 0 && (
                    <p className="text-sm text-neutral-400">No feeders.</p>
                  )}
                </div>
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

// A single feeder's live price + regulator controls (price band + suspension).
function FeederControlCard({ f, onDone }: { f: FeederCtl; onDone: (msg: string) => void }) {
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

  const lo = f.effectiveFloor;
  const hi = f.effectiveCeiling;
  const price = f.clearingPrice;
  // Marker position of the clearing price within the regulated band (0–100%).
  const pricePct =
    price != null && hi > lo ? Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100)) : null;
  const resumesIn = remainingLabel(f.tradingSuspendedUntil);

  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      {/* Header: identity + trading state */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-400">{f.code}</span>
            <StatusBadge value={f.congestionLevel} />
          </div>
          <div className="mt-0.5 truncate text-[15px] font-semibold text-neutral-900">{f.name}</div>
        </div>
        <span
          className={`inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            f.suspended ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${f.suspended ? "bg-red-500" : "animate-pulse bg-green-500"}`} />
          {f.suspended ? "Suspended" : "Trading"}
        </span>
      </div>

      {/* Clearing price + band gauge */}
      <div className="mt-4 rounded-xl border border-neutral-100 bg-neutral-50 p-3.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Clearing price</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums text-neutral-900">
                {price != null ? price.toFixed(2) : "—"}
              </span>
              <span className="text-xs text-neutral-400">cr/kWh</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Band</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-700">{lo}–{hi}</div>
          </div>
        </div>
        {/* Gauge: where the clearing price sits inside the regulated band */}
        <div className="mt-3">
          <div className="relative h-1.5 rounded-full bg-gradient-to-r from-neutral-200 via-neutral-200 to-neutral-200">
            {pricePct != null && (
              <span
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-leaf shadow"
                style={{ left: `${pricePct}%` }}
                title={`${price?.toFixed(2)} cr/kWh`}
              />
            )}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-neutral-400">
            <span>{lo}</span>
            <span>{hi}</span>
          </div>
        </div>
      </div>

      {/* Regulated price band controls */}
      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Set price band · cr/kWh</div>
        <div className="flex items-center gap-2">
          <input
            className={`${inputClass} px-2.5 py-1.5 text-center text-sm tabular-nums`}
            type="number" step="0.1" min="0" placeholder="min"
            value={floor} onChange={(e) => setFloor(e.target.value)}
          />
          <span className="text-neutral-300">–</span>
          <input
            className={`${inputClass} px-2.5 py-1.5 text-center text-sm tabular-nums`}
            type="number" step="0.1" min="0" placeholder="max"
            value={ceiling} onChange={(e) => setCeiling(e.target.value)}
          />
          <Btn size="sm" disabled={busy} onClick={saveBand}>Set</Btn>
        </div>
      </div>

      {/* Trading suspension */}
      <div className="mt-4 border-t border-neutral-100 pt-4">
        {f.suspended ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              <span className="font-semibold text-red-700">Suspended</span>
              {resumesIn && <span className="text-red-500">· resumes in {resumesIn}</span>}
            </div>
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => post({ suspendMinutes: 0 }, `${f.code} trading resumed`)}>
              Resume
            </Btn>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
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
  );
}
