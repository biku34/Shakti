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
type Rec = { _id: string; serial: string; energyMwh: number; status: string; issueTxHash: string | null; creditsAwarded: number; listed?: boolean; askCreditsPerKwh?: number | null; currentHolderId?: string };
type MarketItem = {
  _id: string; serial: string; energyMwh: number; askCreditsPerKwh: number; totalCredits: number;
  generationWindow: { from: string; to: string }; feederCode: string; generatorName: string; holderName: string;
  status: string; issueTxHash: string | null; isOwn: boolean;
};
type HistoryEvent = { action: string; fromName: string | null; toName: string | null; credits: number | null; anchorTxHash: string | null; at: string };
type HistoryResp = { serial: string; energyMwh: number; status: string; issueTxHash: string | null; contentHash: string | null; events: HistoryEvent[] };

function NavIcon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const TABS = [
  { id: "home", label: "Home", icon: <NavIcon path="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" /> },
  { id: "sell", label: "Marketplace", icon: <NavIcon path="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" /> },
  { id: "desk", label: "Transactions", icon: <NavIcon path="M3 3v18h18M7 15l3.5-4 3 2.5L20 7" /> },
  { id: "recs", label: "My RECs", icon: <NavIcon path="M12 21s7-4 7-10V5l-7-2-7 2v6c0 6 7 10 7 10z" /> },
  { id: "market", label: "REC Market", icon: <NavIcon path="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" /> },
];

export default function ProsumerDashboard({ feederId }: { feederId: string | null }) {
  const { show, node } = useToast();
  const me = useApi<{ _id: string; creditBalance: number }>("/api/me", 5000);
  const meters = useApi<MetersResp>("/api/meters/mine", 5000);
  const trades = useApi<Trade[]>("/api/trades/mine", 5000);
  const recs = useApi<Rec[]>("/api/rec/mine", 5000);
  const market = useApi<MarketItem[]>("/api/rec/market", 5000);
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

  const [listing, setListing] = useState<Rec | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  async function buyRec(m: MarketItem) {
    if (!window.confirm(`Buy ${m.serial} for ${m.totalCredits.toFixed(2)} cr?`)) return;
    try {
      const r = await api<{ totalCredits: number }>(`/api/rec/${m._id}/buy`, { method: "POST" });
      show(`Purchased ${m.serial} for ${r.totalCredits.toFixed(2)} cr`);
      market.refetch(); recs.refetch(); me.refetch(); trades.refetch();
    } catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }

  async function unlist(id: string) {
    try {
      await api(`/api/rec/${id}/unlist`, { method: "POST" });
      show("REC unlisted"); recs.refetch(); market.refetch();
    } catch (e) { show(e instanceof Error ? e.message : "Failed"); }
  }

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
            <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
              <RecRequestForm
                meters={meters.data?.meters ?? []}
                availableSurplusKwh={t?.availableSurplusKwh ?? 0}
                onDone={(m) => { show(m); recs.refetch(); meters.refetch(); me.refetch(); }}
              />
              <Card title="My RECs">
                <Table head={["Serial", "Energy kWh", "Status", "Credits", "Market", "Issue anchor", ""]} rows={recs.data?.length ?? 0}>
                  {recs.data?.map((r) => (
                    <tr key={r._id}>
                      <Td className="font-mono text-xs">{r.serial}</Td>
                      <Td className="tabular-nums">{(r.energyMwh * 1000).toFixed(1)}</Td>
                      <Td><StatusBadge value={r.status} /></Td>
                      <Td className="tabular-nums">{r.creditsAwarded > 0 ? `+${r.creditsAwarded.toFixed(2)}` : "—"}</Td>
                      <Td>
                        {r.currentHolderId === me.data?._id && ["issued", "transferred"].includes(r.status) ? (
                          r.listed ? (
                            <div className="flex items-center gap-2">
                              <span className="whitespace-nowrap text-xs text-leaf">Listed · {r.askCreditsPerKwh} cr/kWh</span>
                              <Btn size="sm" variant="ghost" onClick={() => unlist(r._id)}>Unlist</Btn>
                            </div>
                          ) : (
                            <Btn size="sm" variant="ghost" onClick={() => setListing(r)}>List</Btn>
                          )
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </Td>
                      <Td><TxLink hash={r.issueTxHash} /></Td>
                      <Td>
                        {r.status === "pending" && (
                          <Btn size="sm" variant="danger" onClick={async () => {
                            try { await api(`/api/rec/${r._id}/cancel`, { method: "POST" }); show("REC request cancelled — surplus released"); recs.refetch(); meters.refetch(); }
                            catch (e) { show(e instanceof Error ? e.message : "Failed"); }
                          }}>Cancel</Btn>
                        )}
                        {["issued", "transferred"].includes(r.status) && (
                          <span className="flex gap-1">
                            <Btn size="sm" variant="ghost" onClick={() => setHistoryId(r._id)}>History</Btn>
                            {r.currentHolderId === me.data?._id && (
                              <Btn size="sm" variant="ghost" onClick={async () => {
                                try { await api(`/api/rec/${r._id}/retire`, { method: "POST" }); show("REC retired"); recs.refetch(); }
                                catch (e) { show(e instanceof Error ? e.message : "Failed"); }
                              }}>Retire</Btn>
                            )}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          )}

          {active === "market" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-800">REC secondary market</h2>
                  <p className="text-xs text-neutral-400">Buy certified renewable certificates. Credits are the only currency.</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-neutral-400">Your balance</div>
                  <div className="tabular-nums text-lg font-semibold text-neutral-900">
                    {(me.data?.creditBalance ?? 0).toFixed(2)} <span className="text-xs font-normal text-neutral-400">cr</span>
                  </div>
                </div>
              </div>
              {market.data && market.data.length === 0 && (
                <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-10 text-center text-sm text-neutral-400">
                  No RECs listed for sale right now.
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {market.data?.map((m) => (
                  <MarketCard key={m._id} item={m} balance={me.data?.creditBalance ?? 0} onBuy={buyRec} onHistory={() => setHistoryId(m._id)} />
                ))}
              </div>
            </div>
          )}

          {listing && (
            <ListModal
              rec={listing}
              onClose={() => setListing(null)}
              onDone={(msg) => { show(msg); setListing(null); recs.refetch(); market.refetch(); }}
            />
          )}

          {historyId && <HistoryModal recId={historyId} onClose={() => setHistoryId(null)} />}

          {node}
        </>
      )}
    </Tabs>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// One listed REC in the secondary market — priced and buyable in credits.
function MarketCard({ item, balance, onBuy, onHistory }: { item: MarketItem; balance: number; onBuy: (m: MarketItem) => void; onHistory: () => void }) {
  const kwh = (item.energyMwh * 1000).toFixed(1);
  const afford = balance >= item.totalCredits;
  const disabled = item.isOwn || !afford;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-neutral-500">{item.serial}</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums text-neutral-900">
            {kwh} <span className="text-sm font-normal text-neutral-400">kWh</span>
          </div>
        </div>
        {item.issueTxHash ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">Anchored</span>
        ) : (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">unverified</span>
        )}
      </div>
      <div className="space-y-0.5 text-xs text-neutral-500">
        <div>Seller <span className="text-neutral-700">{item.holderName}</span></div>
        <div>Generator <span className="text-neutral-700">{item.generatorName}</span> · {item.feederCode}</div>
        <div>Window {fmtDate(item.generationWindow.from)} – {fmtDate(item.generationWindow.to)}</div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 border-t border-neutral-100 pt-3">
        <div>
          <div className="text-xs text-neutral-400">{item.askCreditsPerKwh} cr/kWh</div>
          <div className="text-lg font-semibold tabular-nums text-neutral-900">
            {item.totalCredits.toFixed(2)} <span className="text-xs font-normal text-neutral-400">cr</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Btn size="sm" variant="ghost" onClick={onHistory}>History</Btn>
          <Btn size="sm" disabled={disabled} onClick={() => onBuy(item)}>
            {item.isOwn ? "Your listing" : afford ? "Buy" : "Low balance"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  issue: "Issued", transfer: "Transferred", retire: "Retired", revoke: "Revoked",
};

// Provenance / ownership chain: every anchored event on a certificate, in order,
// with its on-chain hash — issuance, each purchase/transfer, then retire/revoke.
function HistoryModal({ recId, onClose }: { recId: string; onClose: () => void }) {
  const hist = useApi<HistoryResp>(`/api/rec/${recId}/history`);
  const h = hist.data;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-700">Ownership &amp; hash history</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close">✕</button>
        </div>

        {!h && <p className="py-10 text-center text-sm text-neutral-400">Loading history…</p>}

        {h && (
          <>
            <div className="mb-4 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500">
              <div className="font-mono text-neutral-700">{h.serial}</div>
              <div>{(h.energyMwh * 1000).toFixed(1)} kWh · <span className="capitalize">{h.status}</span></div>
            </div>

            <ol className="relative space-y-4 border-l border-neutral-200 pl-4">
              {h.events.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-leaf ring-2 ring-white" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-800">{HISTORY_LABEL[e.action] ?? e.action}</span>
                    {e.credits != null && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600">{e.credits.toFixed(2)} cr</span>
                    )}
                    <span className="ml-auto text-[11px] text-neutral-400">{new Date(e.at).toLocaleString()}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {e.fromName ? <>{e.fromName} <span className="text-neutral-300">→</span> {e.toName}</> : <>to {e.toName}</>}
                  </div>
                  <div className="mt-1">
                    {e.anchorTxHash ? <TxLink hash={e.anchorTxHash} /> : <span className="text-[11px] text-neutral-400">not anchored</span>}
                  </div>
                </li>
              ))}
              {h.events.length === 0 && <li className="text-sm text-neutral-400">No anchored events yet.</li>}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

// Holder sets an ask price (cr/kWh) to list a REC on the secondary market.
function ListModal({ rec, onClose, onDone }: { rec: Rec; onClose: () => void; onDone: (m: string) => void }) {
  const [price, setPrice] = useState(String(REC_CREDIT_PER_KWH));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = Number(price) || 0;
  const kwh = rec.energyMwh * 1000;
  const total = ask * kwh;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ask <= 0) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/rec/${rec._id}/list`, { method: "POST", body: { askCreditsPerKwh: ask } });
      onDone(`Listed ${rec.serial} at ${ask} cr/kWh`);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-700">List REC for sale</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close">✕</button>
        </div>
        <div className="mb-3 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500">
          <div className="font-mono text-neutral-700">{rec.serial}</div>
          <div>{kwh.toFixed(1)} kWh</div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Ask price (cr/kWh)">
            <input className={inputClass} type="number" step="0.1" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
          <div className="rounded-lg border border-neutral-200 px-3 py-2">
            <div className="text-xs text-neutral-400">Buyer pays (total)</div>
            <div className="tabular-nums text-lg font-semibold text-neutral-900">{total.toFixed(2)} <span className="text-xs font-normal text-neutral-400">cr</span></div>
          </div>
          <div className="[&>button]:w-full">
            <Btn type="submit" disabled={busy || ask <= 0}>{busy ? "Listing…" : "List for sale"}</Btn>
          </div>
        </form>
        <div className="mt-3"><ErrorNote error={error} /></div>
      </div>
    </div>
  );
}

function ChartWait() {
  return (
    <div className="flex h-[230px] items-center justify-center text-sm text-neutral-400">
      Waiting for live meter data…
    </div>
  );
}

// Credits paid per MWh certified — mirrors env.rec.creditPerMwh (server is
// authoritative; this is only for the on-screen estimate).
const REC_CREDIT_PER_MWH = 2500;
const REC_CREDIT_PER_KWH = REC_CREDIT_PER_MWH / 1000; // 2.5 cr/kWh

function RecRequestForm({
  meters,
  availableSurplusKwh,
  onDone,
}: {
  meters: MeterRow[];
  availableSurplusKwh: number;
  onDone: (m: string) => void;
}) {
  const [energyKwh, setEnergyKwh] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestedKwh = Number(energyKwh) || 0;
  const estCredits = requestedKwh * REC_CREDIT_PER_KWH;
  // Client-side guard so the prosumer sees the shortfall before the server rejects it.
  const shortfall = requestedKwh > availableSurplusKwh + 1e-6;
  const invalid = requestedKwh <= 0 || shortfall;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true); setError(null);
    try {
      // The REC API/certificate work in MWh; convert the kWh input on the wire.
      await api("/api/rec/request", { method: "POST", body: { meterCode: meters[0]?.code, energyMwh: requestedKwh / 1000 } });
      onDone("REC requested — surplus held, pending certificate-body approval");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Request a REC from verified generation">
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-lg border border-neutral-200 px-3 py-2">
          <div className="text-xs text-neutral-400">Available surplus</div>
          <div className="tabular-nums text-lg font-semibold text-leaf">{availableSurplusKwh.toFixed(2)} <span className="text-xs font-normal text-neutral-400">kWh</span></div>
        </div>
        <div className="rounded-lg border border-neutral-200 px-3 py-2">
          <div className="text-xs text-neutral-400">Resale value (est.)</div>
          <div className="tabular-nums text-lg font-semibold text-neutral-900">≈ {estCredits.toFixed(2)} <span className="text-xs font-normal text-neutral-400">cr</span></div>
        </div>
        <Field label="Energy (kWh)">
          <input className={inputClass} type="number" step="0.1" min="0" value={energyKwh} onChange={(e) => setEnergyKwh(e.target.value)} required />
        </Field>
        <div className="[&>button]:w-full">
          <Btn type="submit" disabled={busy || invalid}>{busy ? "Requesting…" : "Request REC"}</Btn>
        </div>
      </form>

      <p className="mt-2 text-xs text-neutral-400">
        Requesting {requestedKwh.toFixed(1)} kWh. On request the exact surplus is <b>held</b>; on approval the REC is
        <b> issued & anchored on-chain</b> (no payment). You earn only when you <b>sell</b> it on the REC market —
        list it for ≈{REC_CREDIT_PER_KWH.toFixed(1)} cr/kWh.
      </p>
      {shortfall && (
        <p className="mt-1 text-xs text-red-600">
          Not enough available surplus — you have {availableSurplusKwh.toFixed(2)} kWh but requested {requestedKwh.toFixed(1)} kWh.
        </p>
      )}
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Card>
  );
}
