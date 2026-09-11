"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import {
  Card, Stat, Table, Td, StatusBadge, Tabs, Btn, Field, inputClass,
  ErrorNote, TxLink, useApi, useToast,
} from "@/components/ui";
import OrderBook from "@/components/OrderBook";

type Bid = { _id: string; quantityKwh: number; remainingKwh: number; maxPricePerKwh: number; status: string; expiresAt: string };
type Trade = { _id: string; quantityKwh: number; pricePerKwh: number; totalCredits: number; status: string; anchorTxHash: string | null };

const TABS = [
  { id: "home", label: "Home" },
  { id: "discover", label: "Discover Energy" },
  { id: "bid", label: "Place Bid" },
  { id: "trades", label: "My Trades" },
  { id: "consumption", label: "My Consumption" },
];

// Retail reference used to estimate savings vs buying from the grid.
const RETAIL_REF = 8.5;

export default function ConsumerDashboard({ feederId }: { feederId: string | null }) {
  const { show, node } = useToast();
  const bids = useApi<Bid[]>("/api/bids/mine", 5000);
  const trades = useApi<Trade[]>("/api/trades/mine", 5000);

  const bought = (trades.data ?? []).filter((x) => x.status === "settled");
  const spend = bought.reduce((s, x) => s + x.totalCredits, 0);
  const boughtKwh = bought.reduce((s, x) => s + x.quantityKwh, 0);
  const savings = bought.reduce((s, x) => s + x.quantityKwh * (RETAIL_REF - x.pricePerKwh), 0);

  return (
    <Tabs tabs={TABS}>
      {(active) => (
        <>
          {active === "home" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Energy bought" value={boughtKwh.toFixed(2)} unit="kWh" accent="grid" />
                <Stat label="Total spend" value={spend.toFixed(2)} unit="cr" accent="red" />
                <Stat label="Est. savings vs grid" value={savings.toFixed(2)} unit="cr" accent="leaf" />
                <Stat label="Settled buys" value={bought.length} />
              </div>
              <OrderBook feederId={feederId} />
            </div>
          )}

          {active === "discover" && <OrderBook feederId={feederId} />}

          {active === "bid" && (
            <div className="space-y-6">
              <BidForm onDone={(m) => { show(m); bids.refetch(); trades.refetch(); }} />
              <Card title="My bids">
                <Table head={["Qty", "Remaining", "Max price", "Status", "Expires", ""]} rows={bids.data?.length ?? 0}>
                  {bids.data?.map((b) => (
                    <tr key={b._id}>
                      <Td className="tabular-nums">{b.quantityKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums">{b.remainingKwh.toFixed(2)}</Td>
                      <Td className="tabular-nums">{b.maxPricePerKwh.toFixed(2)}</Td>
                      <Td><StatusBadge value={b.status} /></Td>
                      <Td className="text-xs text-neutral-400">{new Date(b.expiresAt).toLocaleTimeString()}</Td>
                      <Td>
                        {["open", "partial"].includes(b.status) && (
                          <Btn size="sm" variant="ghost" onClick={async () => {
                            try { await api(`/api/bids/${b._id}`, { method: "DELETE" }); show("Bid cancelled"); bids.refetch(); }
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
              <Table head={["Qty kWh", "Price", "Total cr", "Status", "Anchor"]} rows={trades.data?.length ?? 0}>
                {trades.data?.map((x) => (
                  <tr key={x._id}>
                    <Td className="tabular-nums">{x.quantityKwh.toFixed(2)}</Td>
                    <Td className="tabular-nums">{x.pricePerKwh.toFixed(2)}</Td>
                    <Td className="tabular-nums font-medium text-red-600">−{x.totalCredits.toFixed(2)}</Td>
                    <Td><StatusBadge value={x.status} /></Td>
                    <Td><TxLink hash={x.anchorTxHash} /></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "consumption" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Local energy bought" value={boughtKwh.toFixed(2)} unit="kWh" accent="leaf" />
                <Stat label="Avg local price" value={boughtKwh ? (spend / boughtKwh).toFixed(2) : "—"} unit="cr/kWh" />
                <Stat label="Grid reference" value={RETAIL_REF.toFixed(2)} unit="cr/kWh" accent="grid" />
              </div>
              <Card>
                <p className="text-sm text-neutral-500">
                  Buying locally at an average of{" "}
                  <strong>{boughtKwh ? (spend / boughtKwh).toFixed(2) : "—"}</strong> cr/kWh vs a{" "}
                  <strong>{RETAIL_REF.toFixed(2)}</strong> cr/kWh grid rate — an estimated{" "}
                  <strong className="text-leaf">{savings.toFixed(2)} credits</strong> saved so far.
                </p>
              </Card>
            </div>
          )}
          {node}
        </>
      )}
    </Tabs>
  );
}

function BidForm({ onDone }: { onDone: (m: string) => void }) {
  const [qty, setQty] = useState("");
  const [max, setMax] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ match: { filledKwh: number } }>("/api/bids", {
        method: "POST",
        body: { quantityKwh: Number(qty), maxPricePerKwh: Number(max) },
      });
      setQty(""); setMax("");
      onDone(r.match.filledKwh > 0 ? `Bid placed — matched ${r.match.filledKwh} kWh instantly` : "Bid placed — waiting for a matching offer");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Place a buy bid (matches instantly against cheapest offers)">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3 sm:items-end">
        <Field label="Quantity (kWh)">
          <input className={inputClass} type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </Field>
        <Field label="Max price (cr/kWh)">
          <input className={inputClass} type="number" step="0.01" min="0" value={max} onChange={(e) => setMax(e.target.value)} required />
        </Field>
        <Btn type="submit" disabled={busy}>{busy ? "Placing…" : "Place bid"}</Btn>
      </form>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Card>
  );
}
