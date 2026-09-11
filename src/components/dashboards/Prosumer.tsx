"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import {
  Card, Table, Td, StatusBadge, Tabs, Btn, Field, inputClass,
  ErrorNote, TxLink, useApi, useToast,
} from "@/components/ui";
import { LiveChart, KpiTile } from "@/components/charts";
import SellTerminal from "@/components/SellTerminal";
import TradingDesk from "@/components/TradingDesk";

type SeriesPoint = { t: string; generationKw: number; consumptionKw: number; exportKw: number; importKw: number };
type PricePoint = { t: string; price: number; supplyKwh: number; demandKwh: number };
type OrderBookPricing = { clearingPrice: number; supplyKwh: number; demandKwh: number; congestionLevel: string; fitFloor: number; retailCeiling: number };

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

type Totals = {
  generationKwh: number;
  consumptionKwh: number;
  exportKwh: number;
  committedExportKwh: number;
  recBackedKwh: number;
  availableSurplusKwh: number;
};
type MeterRow = {
  id: string;
  code: string;
  solarCapacityKw: number;
  status: string;
  lastReadingAt: string | null;
  latest: { generationKwh: number; exportKwh: number; consumptionKwh: number; importKwh: number } | null;
};
type MetersResp = { meters: MeterRow[]; totals: Totals };
type Offer = { _id: string; quantityKwh: number; remainingKwh: number; askPricePerKwh: number; status: string; expiresAt: string };
type Trade = { _id: string; quantityKwh: number; pricePerKwh: number; totalCredits: number; status: string; anchorTxHash: string | null; buyerId: string; sellerId: string; settledAt: string | null; createdAt: string | null };
type Rec = { _id: string; serial: string; energyMwh: number; status: string; issueTxHash: string | null };

function NavIcon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const TABS = [
  { id: "home", label: "Home", icon: <NavIcon path="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" /> },
  { id: "sell", label: "Sell Surplus", icon: <NavIcon path="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" /> },
  { id: "desk", label: "Trading Desk", icon: <NavIcon path="M3 3v18h18M7 15l3.5-4 3 2.5L20 7" /> },
  { id: "recs", label: "My RECs", icon: <NavIcon path="M12 21s7-4 7-10V5l-7-2-7 2v6c0 6 7 10 7 10z" /> },
];

export default function ProsumerDashboard({ feederId }: { feederId: string | null }) {
  const { show, node } = useToast();
  const me = useApi<{ _id: string }>("/api/me", 30000);
  const meters = useApi<MetersResp>("/api/meters/mine", 5000);
  const trades = useApi<Trade[]>("/api/trades/mine", 5000);
  const recs = useApi<Rec[]>("/api/rec/mine", 5000);
  const series = useApi<{ points: SeriesPoint[] }>("/api/meters/mine/series?points=48", 3000);
  const priceHist = useApi<{ points: PricePoint[] }>(
    feederId ? `/api/feeders/${feederId}/price-history?points=60` : null,
    3000,
  );
  const ob = useApi<{ pricing: OrderBookPricing }>(
    feederId ? `/api/feeders/${feederId}/orderbook` : null,
    3000,
  );
  const t = meters.data?.totals;

  const pts = series.data?.points ?? [];
  const xLabels = pts.map((p) => hhmm(p.t));
  const exportKw = pts.map((p) => p.exportKw);
  const importKw = pts.map((p) => p.importKw);
  const generationKw = pts.map((p) => p.generationKw);
  const consumptionKw = pts.map((p) => p.consumptionKw);
  // Cumulative exported energy across the window — a rising "surplus building up"
  // trend for the Available-surplus tile sparkline.
  const surplusTrend: number[] = [];
  pts.reduce((acc, p) => {
    const next = acc + p.exportKw;
    surplusTrend.push(Number(next.toFixed(2)));
    return next;
  }, 0);
  const priceSeries = (priceHist.data?.points ?? []).map((p) => p.price);
  const pricing = ob.data?.pricing;

  return (
    <Tabs tabs={TABS} sidebar>
      {(active) => (
        <>
          {active === "home" && (
            <div className="space-y-6">
              {/* KPI ticker row */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiTile label="Solar output" value={generationKw.at(-1) ?? 0} unit="kW" color="#d69e2e" spark={generationKw} sparkColor="#d69e2e" />
                <KpiTile label="Exporting now" value={exportKw.at(-1) ?? 0} unit="kW" color="#16a34a" spark={exportKw} sparkColor="#16a34a" />
                <KpiTile label="Available surplus" value={t?.availableSurplusKwh ?? 0} unit="kWh" color="#2b6cb0" spark={surplusTrend} sparkColor="#2b6cb0" />
                <KpiTile label="Clearing price" value={pricing?.clearingPrice ?? priceSeries.at(-1) ?? 0} unit="cr/kWh" color="#16a34a" spark={priceSeries} sparkColor="#16a34a" />
              </div>

              {/* Three live charts in one row (full width) */}
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {/* Import vs Export */}
                <Card
                  title="Import vs Export"
                  actions={<span className="hidden text-xs text-neutral-400 sm:inline">kW · sim {pts.length ? xLabels.at(-1) : "—"}</span>}
                >
                  {pts.length < 2 ? (
                    <ChartWait />
                  ) : (
                    <LiveChart
                      height={230}
                      yUnit="kW"
                      xLabels={xLabels}
                      series={[
                        { key: "export", label: "Export", color: "#16a34a", points: exportKw },
                        { key: "import", label: "Import", color: "#2b6cb0", points: importKw },
                      ]}
                    />
                  )}
                </Card>

                {/* Generation vs consumption */}
                <Card title="Generation vs Consumption">
                  {pts.length < 2 ? (
                    <ChartWait />
                  ) : (
                    <LiveChart
                      height={230}
                      yUnit="kW"
                      xLabels={xLabels}
                      series={[
                        { key: "gen", label: "Generation", color: "#d69e2e", points: generationKw },
                        { key: "cons", label: "Consumption", color: "#e53e3e", points: consumptionKw },
                      ]}
                    />
                  )}
                </Card>

                {/* Market clearing price */}
                <Card title="Market clearing price">
                  {priceSeries.length < 2 ? (
                    <ChartWait />
                  ) : (
                    <LiveChart
                      height={230}
                      yUnit="cr"
                      baseZero={false}
                      area={false}
                      xLabels={(priceHist.data?.points ?? []).map((p) => hhmm(p.t))}
                      series={[{ key: "price", label: "Clearing price", color: "#7c3aed", points: priceSeries }]}
                    />
                  )}
                  {pricing && (
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
                      <span>Supply <strong className="text-neutral-800">{pricing.supplyKwh.toFixed(1)}</strong></span>
                      <span>Demand <strong className="text-neutral-800">{pricing.demandKwh.toFixed(1)}</strong></span>
                      <span className="flex items-center gap-1">Congestion <StatusBadge value={pricing.congestionLevel} /></span>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {active === "sell" && <SellTerminal feederId={feederId} />}

          {active === "desk" && (
            <TradingDesk trades={trades.data ?? []} clearingPrice={pricing?.clearingPrice} myUserId={me.data?._id ?? null} />
          )}

          {active === "recs" && (
            <div className="space-y-6">
              <RecRequestForm meters={meters.data?.meters ?? []} onDone={(m) => { show(m); recs.refetch(); meters.refetch(); }} />
              <Card title="My RECs">
                <Table head={["Serial", "Energy MWh", "Status", "Issue anchor", ""]} rows={recs.data?.length ?? 0}>
                  {recs.data?.map((r) => (
                    <tr key={r._id}>
                      <Td className="font-mono text-xs">{r.serial}</Td>
                      <Td className="tabular-nums">{r.energyMwh}</Td>
                      <Td><StatusBadge value={r.status} /></Td>
                      <Td><TxLink hash={r.issueTxHash} /></Td>
                      <Td>
                        {["issued", "transferred"].includes(r.status) && (
                          <Btn size="sm" variant="ghost" onClick={async () => {
                            try { await api(`/api/rec/${r._id}/retire`, { method: "POST" }); show("REC retired"); recs.refetch(); }
                            catch (e) { show(e instanceof Error ? e.message : "Failed"); }
                          }}>Retire</Btn>
                        )}
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

function ChartWait() {
  return (
    <div className="flex h-[230px] items-center justify-center text-sm text-neutral-400">
      Waiting for live meter data…
    </div>
  );
}

function RecRequestForm({ meters, onDone }: { meters: MeterRow[]; onDone: (m: string) => void }) {
  const [meterCode, setMeterCode] = useState(meters[0]?.code ?? "");
  const [energyMwh, setEnergyMwh] = useState("0.001");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/api/rec/request", { method: "POST", body: { meterCode: meterCode || meters[0]?.code, energyMwh: Number(energyMwh) } });
      onDone("REC requested — pending certificate-body approval");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Request a REC from verified generation">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3 sm:items-end">
        <Field label="Meter">
          <select className={inputClass} value={meterCode} onChange={(e) => setMeterCode(e.target.value)}>
            {meters.map((m) => <option key={m.id} value={m.code}>{m.code}</option>)}
          </select>
        </Field>
        <Field label="Energy (MWh)">
          <input className={inputClass} type="number" step="0.001" min="0" value={energyMwh} onChange={(e) => setEnergyMwh(e.target.value)} required />
        </Field>
        <Btn type="submit" disabled={busy}>{busy ? "Requesting…" : "Request REC"}</Btn>
      </form>
      <p className="mt-2 text-xs text-neutral-400">1 MWh = 1000 kWh. Demo default 0.001 MWh (1 kWh) to match rooftop scale.</p>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Card>
  );
}
