"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import {
  Card, Stat, Table, Td, StatusBadge, Tabs, Btn, Field, inputClass,
  ErrorNote, TxLink, useApi, useToast,
} from "@/components/ui";
import OrderBook from "@/components/OrderBook";

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
type Trade = { _id: string; quantityKwh: number; pricePerKwh: number; totalCredits: number; status: string; anchorTxHash: string | null; buyerId: string; sellerId: string; settledAt: string | null };
type Rec = { _id: string; serial: string; energyMwh: number; status: string; issueTxHash: string | null };

const TABS = [
  { id: "home", label: "Home" },
  { id: "generation", label: "My Meter / Generation" },
  { id: "sell", label: "Sell Surplus" },
  { id: "trades", label: "My Trades" },
  { id: "recs", label: "My RECs" },
  { id: "earnings", label: "Earnings" },
];

export default function ProsumerDashboard({ feederId }: { feederId: string | null }) {
  const { show, node } = useToast();
  const meters = useApi<MetersResp>("/api/meters/mine", 5000);
  const offers = useApi<Offer[]>("/api/offers/mine", 5000);
  const trades = useApi<Trade[]>("/api/trades/mine", 5000);
  const recs = useApi<Rec[]>("/api/rec/mine", 5000);
  const t = meters.data?.totals;

  const settledSales = (trades.data ?? []).filter((x) => x.status === "settled");
  const earnings = settledSales.reduce((s, x) => s + x.totalCredits, 0);

  return (
    <Tabs tabs={TABS}>
      {(active) => (
        <>
          {active === "home" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Total generated" value={t?.generationKwh.toFixed(1) ?? "—"} unit="kWh" accent="solar" />
                <Stat label="Total exported" value={t?.exportKwh.toFixed(1) ?? "—"} unit="kWh" accent="leaf" />
                <Stat label="Available surplus" value={t?.availableSurplusKwh.toFixed(2) ?? "—"} unit="kWh" accent="grid" />
                <Stat label="Earnings (settled)" value={earnings.toFixed(2)} unit="cr" accent="leaf" />
              </div>
              <OrderBook feederId={feederId} />
            </div>
          )}

          {active === "generation" && (
            <Card title="Bidirectional meters — latest interval">
              <Table head={["Meter", "Capacity kW", "Status", "Gen kWh", "Export kWh", "Import kWh", "Last reading"]} rows={meters.data?.meters.length ?? 0}>
                {meters.data?.meters.map((m) => (
                  <tr key={m.id}>
                    <Td className="font-mono text-xs">{m.code}</Td>
                    <Td className="tabular-nums">{m.solarCapacityKw}</Td>
                    <Td><StatusBadge value={m.status} /></Td>
                    <Td className="tabular-nums">{m.latest?.generationKwh?.toFixed(3) ?? "—"}</Td>
                    <Td className="tabular-nums text-leaf">{m.latest?.exportKwh?.toFixed(3) ?? "—"}</Td>
                    <Td className="tabular-nums text-grid">{m.latest?.importKwh?.toFixed(3) ?? "—"}</Td>
                    <Td className="text-xs text-neutral-400">{m.lastReadingAt ? new Date(m.lastReadingAt).toLocaleString() : "—"}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "sell" && (
            <div className="space-y-6">
              <SellForm
                available={t?.availableSurplusKwh ?? 0}
                onDone={(m) => { show(m); offers.refetch(); meters.refetch(); }}
              />
              <Card title="My offers">
                <Table head={["Qty", "Remaining", "Ask", "Status", "Expires", ""]} rows={offers.data?.length ?? 0}>
                  {offers.data?.map((o) => (
                    <tr key={o._id}>
                      <Td className="tabular-nums">{o.quantityKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums">{o.remainingKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums">{o.askPricePerKwh.toFixed(2)}</Td>
                      <Td><StatusBadge value={o.status} /></Td>
                      <Td className="text-xs text-neutral-400">{new Date(o.expiresAt).toLocaleTimeString()}</Td>
                      <Td>
                        {["open", "partial"].includes(o.status) && (
                          <Btn size="sm" variant="ghost" onClick={async () => {
                            try { await api(`/api/offers/${o._id}`, { method: "DELETE" }); show("Offer cancelled"); offers.refetch(); meters.refetch(); }
                            catch (e) { show(e instanceof Error ? e.message : "Failed"); }
                          }}>Cancel</Btn>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          )}

          {active === "trades" && (
            <Card title="My trades">
              <Table head={["Qty kWh", "Price", "Total cr", "Status", "Anchor", "Settled"]} rows={trades.data?.length ?? 0}>
                {trades.data?.map((x) => (
                  <tr key={x._id}>
                    <Td className="tabular-nums">{x.quantityKwh.toFixed(2)}</Td>
                    <Td className="tabular-nums">{x.pricePerKwh.toFixed(2)}</Td>
                    <Td className="tabular-nums font-medium text-leaf">+{x.totalCredits.toFixed(2)}</Td>
                    <Td><StatusBadge value={x.status} /></Td>
                    <Td><TxLink hash={x.anchorTxHash} /></Td>
                    <Td className="text-xs text-neutral-400">{x.settledAt ? new Date(x.settledAt).toLocaleTimeString() : "—"}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
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

          {active === "earnings" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Energy sold" value={settledSales.reduce((s, x) => s + x.quantityKwh, 0).toFixed(2)} unit="kWh" accent="leaf" />
                <Stat label="Settled trades" value={settledSales.length} />
                <Stat label="Total earned" value={earnings.toFixed(2)} unit="cr" accent="leaf" />
              </div>
              <Card title="Settled sales">
                <Table head={["Qty kWh", "Price", "Credits", "Anchor"]} rows={settledSales.length}>
                  {settledSales.map((x) => (
                    <tr key={x._id}>
                      <Td className="tabular-nums">{x.quantityKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums">{x.pricePerKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums text-leaf">+{x.totalCredits.toFixed(2)}</Td>
                      <Td><TxLink hash={x.anchorTxHash} /></Td>
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

function SellForm({ available, onDone }: { available: number; onDone: (m: string) => void }) {
  const [qty, setQty] = useState("");
  const [ask, setAsk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/api/offers", { method: "POST", body: { quantityKwh: Number(qty), askPricePerKwh: Number(ask) } });
      setQty(""); setAsk("");
      onDone("Offer listed");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card title={`List surplus for sale — ${available.toFixed(2)} kWh available`}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3 sm:items-end">
        <Field label="Quantity (kWh)">
          <input className={inputClass} type="number" step="0.01" min="0" max={available} value={qty} onChange={(e) => setQty(e.target.value)} required />
        </Field>
        <Field label="Ask price (cr/kWh)">
          <input className={inputClass} type="number" step="0.01" min="0" value={ask} onChange={(e) => setAsk(e.target.value)} required />
        </Field>
        <Btn type="submit" disabled={busy || available <= 0}>{busy ? "Listing…" : "List offer"}</Btn>
      </form>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Card>
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
