"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { Card, StatusBadge, useApi, useToast, ErrorNote } from "@/components/ui";
import { LiveChart } from "@/components/charts";

type Pricing = {
  clearingPrice: number;
  supplyKwh: number;
  demandKwh: number;
  congestionLevel: string;
  fitFloor: number;
  retailCeiling: number;
};
type OB = {
  offers: { _id: string; remainingKwh: number; askPricePerKwh: number; status: string }[];
  bids: { _id: string; remainingKwh: number; maxPricePerKwh: number; status: string }[];
  pricing: Pricing;
};
type WorkingOrder = {
  _id: string; quantityKwh: number; remainingKwh: number; status: string; expiresAt: string;
  askPricePerKwh?: number; maxPricePerKwh?: number;
};
type PricePoint = { t: string; price: number };

function hhmm(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const n2 = (n: number) => n.toFixed(2);

type Side = "sell" | "buy";
type OType = "limit" | "market";

export default function SellTerminal({ feederId }: { feederId: string | null }) {
  const { show, node } = useToast();
  const ob = useApi<OB>(feederId ? `/api/feeders/${feederId}/orderbook` : null, 3000);
  const priceHist = useApi<{ points: PricePoint[]; high: number | null; low: number | null; windowMinutes?: number }>(
    feederId ? `/api/feeders/${feederId}/price-history?points=60` : null, 3000);
  const myOffers = useApi<WorkingOrder[]>("/api/offers/mine", 4000);
  const myBids = useApi<WorkingOrder[]>("/api/bids/mine", 4000);
  const meters = useApi<{ totals: { availableSurplusKwh: number } }>("/api/meters/mine", 5000);
  const me = useApi<{ creditBalance: number }>("/api/me", 5000);

  const pricing = ob.data?.pricing;
  const priceSeries = (priceHist.data?.points ?? []).map((p) => p.price);
  const priceLabels = (priceHist.data?.points ?? []).map((p) => hhmm(p.t));
  const ltp = priceSeries.at(-1) ?? pricing?.clearingPrice ?? 0;
  const open = priceSeries[0] ?? ltp;
  const chg = ltp - open;
  const chgPct = open ? (chg / open) * 100 : 0;
  // High/Low over the trailing 60 min (server-computed). Fall back to the chart
  // window only if the API hasn't provided the rolling range yet.
  const hi = priceHist.data?.high ?? (priceSeries.length ? Math.max(...priceSeries) : ltp);
  const lo = priceHist.data?.low ?? (priceSeries.length ? Math.min(...priceSeries) : ltp);

  const surplus = meters.data?.totals.availableSurplusKwh ?? 0;
  const credits = me.data?.creditBalance ?? 0;

  // Depth ladders (top 5 each side).
  const asks = [...(ob.data?.offers ?? [])].sort((a, b) => a.askPricePerKwh - b.askPricePerKwh).slice(0, 5);
  const bids = [...(ob.data?.bids ?? [])].sort((a, b) => b.maxPricePerKwh - a.maxPricePerKwh).slice(0, 5);
  const totalAsk = (ob.data?.offers ?? []).reduce((s, o) => s + o.remainingKwh, 0);
  const totalBid = (ob.data?.bids ?? []).reduce((s, b) => s + b.remainingKwh, 0);

  const workingOffers = (myOffers.data ?? []).filter((o) => ["open", "partial"].includes(o.status));
  const workingBids = (myBids.data ?? []).filter((o) => ["open", "partial"].includes(o.status));

  function refresh() {
    ob.refetch(); myOffers.refetch(); myBids.refetch(); meters.refetch(); me.refetch();
  }

  return (
    <div className="space-y-3">
      {/* ── Instrument strip ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-neutral-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-neutral-900 px-2 py-0.5 text-xs font-bold text-white">
            {feederId ? "GNR FEEDER" : "—"}
          </span>
          <span className="text-sm font-semibold text-neutral-700">Local Energy</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-neutral-900">{n2(ltp)}</span>
          <span className="text-xs text-neutral-400">cr/kWh</span>
          <span className={`text-sm font-semibold tabular-nums ${chg >= 0 ? "text-green-600" : "text-red-500"}`}>
            {chg >= 0 ? "▲" : "▼"} {n2(Math.abs(chg))} ({chgPct >= 0 ? "+" : ""}{chgPct.toFixed(1)}%)
          </span>
        </div>
        <div className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <Stat k="High 1h" v={n2(hi)} />
          <Stat k="Low 1h" v={n2(lo)} />
          <Stat k="Supply" v={`${n2(pricing?.supplyKwh ?? 0)} kWh`} />
          <Stat k="Demand" v={`${n2(pricing?.demandKwh ?? 0)} kWh`} />
          <Stat k="Congestion" node={<StatusBadge value={pricing?.congestionLevel ?? "low"} />} />
          <Stat k="Surplus" v={`${n2(surplus)} kWh`} accent />
          <Stat k="Credits" v={n2(credits)} accent />
        </div>
      </div>

      {/* ── Chart + open orders (left) · order ticket + depth (right) ── */}
      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        {/* Left column */}
        <div className="flex flex-col gap-3">
          <Card
            title="Price"
            actions={<span className="hidden text-xs text-neutral-400 sm:inline">clearing price · live · {priceLabels.at(-1) ?? "—"}</span>}
          >
            {priceSeries.length < 2 ? (
              <div className="flex h-[190px] items-center justify-center text-sm text-neutral-400">Price history builds as the market ticks…</div>
            ) : (
              <LiveChart height={190} yUnit="cr" baseZero={false} area xLabels={priceLabels}
                series={[{ key: "px", label: "Clearing price", color: "#7c3aed", points: priceSeries }]} />
            )}
          </Card>

          {/* Market depth tucked under the chart, filling the left column */}
          <MarketDepth asks={asks} bids={bids} totalAsk={totalAsk} totalBid={totalBid} />
        </div>

        {/* Right column */}
        <div className="space-y-3">
          <OrderTicket
            feederBound={!!feederId}
            pricing={pricing}
            ltp={ltp}
            surplus={surplus}
            credits={credits}
            onDone={(msg) => { show(msg); refresh(); }}
          />
          <Card title={`Open orders (${workingOffers.length + workingBids.length})`}>
            {workingOffers.length + workingBids.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-400">No working orders. Place a buy or sell above.</p>
            ) : (
              <div className="space-y-1.5">
                {workingOffers.map((o) => (
                  <OrderRow key={o._id} side="sell" qty={o.remainingKwh} price={o.askPricePerKwh ?? 0} status={o.status}
                    onCancel={async () => { try { await api(`/api/offers/${o._id}`, { method: "DELETE" }); show("Sell order cancelled"); refresh(); } catch (e) { show(e instanceof Error ? e.message : "Failed"); } }} />
                ))}
                {workingBids.map((b) => (
                  <OrderRow key={b._id} side="buy" qty={b.remainingKwh} price={b.maxPricePerKwh ?? 0} status={b.status}
                    onCancel={async () => { try { await api(`/api/bids/${b._id}`, { method: "DELETE" }); show("Buy order cancelled"); refresh(); } catch (e) { show(e instanceof Error ? e.message : "Failed"); } }} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
      {node}
    </div>
  );
}

// ── Order ticket (Buy / Sell, Market / Limit) ──────────────────────
function OrderTicket({
  feederBound, pricing, ltp, surplus, credits, onDone,
}: {
  feederBound: boolean;
  pricing?: Pricing;
  ltp: number;
  surplus: number;
  credits: number;
  onDone: (m: string) => void;
}) {
  const [side, setSide] = useState<Side>("sell");
  const [otype, setOType] = useState<OType>("limit");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const floor = pricing?.fitFloor ?? 0;
  const ceil = pricing?.retailCeiling ?? 0;
  const effPrice = otype === "market" ? (side === "sell" ? ltp : ceil) : Number(price) || 0;
  const value = useMemo(() => (Number(qty) || 0) * effPrice, [qty, effPrice]);
  const maxQty = side === "sell" ? surplus : (effPrice > 0 ? credits / effPrice : 0);
  const overCap = side === "buy" && value > credits + 1e-6;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const q = Number(qty);
      if (side === "sell") {
        const p = otype === "market" ? ltp : Number(price);
        const r = await api<{ match: { filledKwh: number } }>("/api/offers", { method: "POST", body: { quantityKwh: q, askPricePerKwh: p } });
        onDone(r.match.filledKwh > 0 ? `Sold ${n2(r.match.filledKwh)} kWh instantly` : `Sell order placed — ${n2(q)} kWh @ ${n2(p)}`);
      } else {
        const p = otype === "market" ? ceil : Number(price);
        const r = await api<{ match: { filledKwh: number } }>("/api/bids", { method: "POST", body: { quantityKwh: q, maxPricePerKwh: p } });
        onDone(r.match.filledKwh > 0 ? `Bought ${n2(r.match.filledKwh)} kWh instantly` : "Buy order placed — waiting for a seller");
      }
      setQty(""); setPrice("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const isSell = side === "sell";
  const accent = isSell ? "#16a34a" : "#2b6cb0";
  const invalid = busy || !feederBound || !qty || (otype === "limit" && !price) ||
    (isSell && (surplus <= 0 || Number(qty) > surplus + 1e-6)) || overCap;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      {/* Buy / Sell tabs */}
      <div className="grid grid-cols-2">
        {(["buy", "sell"] as Side[]).map((s) => (
          <button key={s} onClick={() => setSide(s)}
            className={`py-2 text-sm font-bold uppercase tracking-wide transition ${
              side === s
                ? s === "sell" ? "bg-green-600 text-white" : "bg-blue-600 text-white"
                : "bg-neutral-50 text-neutral-400 hover:text-neutral-600"
            }`}>
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-2.5 p-3">
        {/* Market / Limit */}
        <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100/70 p-0.5 text-xs">
          {(["limit", "market"] as OType[]).map((o) => (
            <button key={o} onClick={() => setOType(o)}
              className={`rounded-md px-3 py-1 font-medium capitalize transition ${otype === o ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5" : "text-neutral-500"}`}>
              {o}
            </button>
          ))}
        </div>

        {/* Quantity */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-neutral-500">Quantity (kWh)</span>
            <span className="text-neutral-400">max {n2(maxQty)}</span>
          </div>
          <input type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.00"
            className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-base font-semibold tabular-nums outline-none focus:border-neutral-400" />
          <div className="mt-1.5 flex gap-1">
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <button key={f} onClick={() => setQty((maxQty * f).toFixed(2))}
                className="flex-1 rounded-md bg-neutral-100 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-200">
                {f === 1 ? "Max" : `${f * 100}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Price (limit only) */}
        {otype === "limit" ? (
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-500">{isSell ? "Ask" : "Max"} price (cr/kWh)</div>
            <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-base font-semibold tabular-nums outline-none focus:border-neutral-400" />
            <div className="mt-1.5 flex gap-1">
              <Chip label={`Floor ${floor.toFixed(1)}`} onClick={() => setPrice(floor.toFixed(2))} />
              <Chip label={`LTP ${ltp.toFixed(1)}`} onClick={() => setPrice(ltp.toFixed(2))} />
              <Chip label={`Ceil ${ceil.toFixed(1)}`} onClick={() => setPrice(ceil.toFixed(2))} />
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
            Market order fills at the best available price (≈ {n2(effPrice)} cr/kWh).
          </div>
        )}

        {/* Value + submit */}
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
          <span className="text-neutral-500">{isSell ? "Proceeds" : "Order value"}</span>
          <span className={`font-bold tabular-nums ${overCap ? "text-red-600" : "text-neutral-900"}`}>{n2(value)} cr</span>
        </div>
        {overCap && <p className="text-xs text-red-500">Insufficient credits ({n2(credits)} cr available).</p>}

        <button onClick={submit} disabled={invalid}
          className="w-full rounded-lg py-2 text-sm font-bold uppercase tracking-wide text-white transition disabled:opacity-40"
          style={{ backgroundColor: accent }}>
          {busy ? "Placing…" : `${isSell ? "Sell" : "Buy"} ${qty ? n2(Number(qty)) + " kWh" : ""}`}
        </button>
        <ErrorNote error={error} />
      </div>
    </div>
  );
}

// ── Market depth (5-level bid/ask) ─────────────────────────────────
function MarketDepth({
  asks, bids, totalAsk, totalBid,
}: {
  asks: { _id: string; remainingKwh: number; askPricePerKwh: number }[];
  bids: { _id: string; remainingKwh: number; maxPricePerKwh: number }[];
  totalAsk: number; totalBid: number;
}) {
  const maxQty = Math.max(...asks.map((a) => a.remainingKwh), ...bids.map((b) => b.remainingKwh), 0.0001);
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Bids block */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-blue-600">Bids</h3>
        <div className="mb-1 flex justify-between text-xs font-medium uppercase tracking-wide text-neutral-400">
          <span>Bid qty</span><span>Bid</span>
        </div>
        <div className="text-xs">
          {(bids.length ? bids : [null]).map((b, i) => (
            <DepthCell key={b?._id ?? i} side="bid" qty={b?.remainingKwh} price={b?.maxPricePerKwh} max={maxQty} />
          ))}
        </div>
        <div className="mt-2 flex justify-between border-t border-neutral-100 pt-2 text-xs">
          <span className="text-neutral-400">Total buy</span>
          <span className="font-semibold tabular-nums text-blue-600">{n2(totalBid)}</span>
        </div>
      </div>

      {/* Asks block */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-green-600">Asks</h3>
        <div className="mb-1 flex justify-between text-xs font-medium uppercase tracking-wide text-neutral-400">
          <span>Ask</span><span>Ask qty</span>
        </div>
        <div className="text-xs">
          {(asks.length ? asks : [null]).map((a, i) => (
            <DepthCell key={a?._id ?? i} side="ask" qty={a?.remainingKwh} price={a?.askPricePerKwh} max={maxQty} />
          ))}
        </div>
        <div className="mt-2 flex justify-between border-t border-neutral-100 pt-2 text-xs">
          <span className="font-semibold tabular-nums text-green-600">{n2(totalAsk)}</span>
          <span className="text-neutral-400">Total sell</span>
        </div>
      </div>
    </div>
  );
}

function DepthCell({ side, qty, price, max }: { side: "bid" | "ask"; qty?: number; price?: number; max: number }) {
  const color = side === "bid" ? "#2b6cb0" : "#16a34a";
  if (qty == null || price == null) return <div className="py-1 text-neutral-300">—</div>;
  const pct = (qty / max) * 100;
  return (
    <div className="relative flex items-center justify-between overflow-hidden rounded px-1.5 py-1 tabular-nums">
      <div className={`absolute inset-y-0 opacity-10 ${side === "bid" ? "left-0" : "right-0"}`} style={{ width: `${pct}%`, backgroundColor: color }} />
      {side === "bid" ? (
        <>
          <span className="relative text-neutral-600">{n2(qty)}</span>
          <span className="relative font-semibold" style={{ color }}>{n2(price)}</span>
        </>
      ) : (
        <>
          <span className="relative font-semibold" style={{ color }}>{n2(price)}</span>
          <span className="relative text-neutral-600">{n2(qty)}</span>
        </>
      )}
    </div>
  );
}

// ── Working-order row ──────────────────────────────────────────────
function OrderRow({ side, qty, price, status, onCancel }: { side: Side; qty: number; price: number; status: string; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${side === "sell" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}`}>{side}</span>
        <span className="tabular-nums text-neutral-700">{n2(qty)} kWh @ {n2(price)}</span>
        <StatusBadge value={status} />
      </div>
      <button onClick={onCancel} className="text-xs font-medium text-red-500 hover:underline">Cancel</button>
    </div>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 whitespace-nowrap rounded-md bg-neutral-100 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-200">
      {label}
    </button>
  );
}

function Stat({ k, v, node, accent }: { k: string; v?: string; node?: React.ReactNode; accent?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-neutral-400">{k}</span>
      {node ?? <span className={`font-semibold tabular-nums ${accent ? "text-neutral-900" : "text-neutral-700"}`}>{v}</span>}
    </span>
  );
}
