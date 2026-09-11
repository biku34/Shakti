"use client";

import { Card, Stat, Table, Td, StatusBadge, useApi } from "@/components/ui";

type Offer = { _id: string; remainingKwh: number; askPricePerKwh: number; status: string };
type Bid = { _id: string; remainingKwh: number; maxPricePerKwh: number; status: string };
type Pricing = {
  clearingPrice: number;
  fitFloor: number;
  retailCeiling: number;
  supplyKwh: number;
  demandKwh: number;
  congestionLevel: string;
};
type OrderBookData = { offers: Offer[]; bids: Bid[]; pricing: Pricing };

// Live order book scoped to a feeder (FR-3.6). Polls every 3s (NFR-P2).
export default function OrderBook({ feederId }: { feederId: string | null }) {
  const { data } = useApi<OrderBookData>(feederId ? `/api/feeders/${feederId}/orderbook` : null, 3000);
  const p = data?.pricing;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clearing price" value={p ? p.clearingPrice.toFixed(2) : "—"} unit="cr/kWh" accent="leaf" />
        <Stat label="Supply (open)" value={p ? p.supplyKwh.toFixed(2) : "—"} unit="kWh" accent="solar" />
        <Stat label="Demand (open)" value={p ? p.demandKwh.toFixed(2) : "—"} unit="kWh" accent="grid" />
        <Stat label="Congestion" value={p?.congestionLevel ?? "—"} />
      </div>

      {p && (
        <p className="text-xs text-neutral-400">
          Price bounded to [{p.fitFloor.toFixed(2)} floor · {p.retailCeiling.toFixed(2)} ceiling] cr/kWh — §9.1
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Sell offers (ask ↑)">
          <Table head={["Qty kWh", "Ask cr/kWh", "Status"]} rows={data?.offers.length ?? 0}>
            {data?.offers.map((o) => (
              <tr key={o._id}>
                <Td className="tabular-nums">{o.remainingKwh.toFixed(2)}</Td>
                <Td className="tabular-nums font-medium">{o.askPricePerKwh.toFixed(2)}</Td>
                <Td><StatusBadge value={o.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Buy bids (max ↓)">
          <Table head={["Qty kWh", "Max cr/kWh", "Status"]} rows={data?.bids.length ?? 0}>
            {data?.bids.map((b) => (
              <tr key={b._id}>
                <Td className="tabular-nums">{b.remainingKwh.toFixed(2)}</Td>
                <Td className="tabular-nums font-medium">{b.maxPricePerKwh.toFixed(2)}</Td>
                <Td><StatusBadge value={b.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
