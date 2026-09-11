"use client";

import { useMemo, useState } from "react";
import { Card, Table, Td, StatusBadge, TxLink } from "@/components/ui";
import { LiveChart, KpiTile } from "@/components/charts";

export type DeskTrade = {
  _id: string;
  quantityKwh: number;
  pricePerKwh: number;
  totalCredits: number;
  status: string;
  anchorTxHash: string | null;
  settledAt: string | null;
  createdAt?: string | null;
};

function ts(x: DeskTrade): number {
  const s = x.settledAt ?? x.createdAt;
  return s ? new Date(s).getTime() : 0;
}
function hhmm(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function isToday(ms: number): boolean {
  if (!ms) return false;
  const d = new Date(ms);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

type FilterId = "all" | "settled" | "inflight" | "failed";

/**
 * Trading Desk — a single stock-market-style view that merges the old
 * "My Trades" ledger with the "Earnings" summary. A portfolio hero, an
 * equity (cumulative-earnings) curve, a realized-price-vs-market panel,
 * and a filterable fills ledger.
 */
export default function TradingDesk({
  trades,
  clearingPrice,
}: {
  trades: DeskTrade[];
  clearingPrice?: number;
}) {
  const [filter, setFilter] = useState<FilterId>("all");

  const m = useMemo(() => {
    const all = [...trades].sort((a, b) => ts(b) - ts(a));
    const settled = all.filter((x) => x.status === "settled");
    const inflight = all.filter((x) => x.status === "matched");
    const failed = all.filter((x) => x.status === "failed");

    // Settled in chronological order → equity + volume curves.
    const chrono = [...settled].sort((a, b) => ts(a) - ts(b));
    const equity: number[] = [];
    const volume: number[] = [];
    const fillPrices: number[] = [];
    const fillLabels: string[] = [];
    let cumCr = 0;
    let cumKwh = 0;
    for (const x of chrono) {
      cumCr += x.totalCredits;
      cumKwh += x.quantityKwh;
      equity.push(Number(cumCr.toFixed(2)));
      volume.push(Number(cumKwh.toFixed(2)));
      fillPrices.push(Number(x.pricePerKwh.toFixed(2)));
      fillLabels.push(hhmm(ts(x)));
    }

    const energySold = cumKwh;
    const totalEarned = cumCr;
    const vwap = energySold > 0 ? totalEarned / energySold : 0;
    const bestFill = settled.length ? Math.max(...settled.map((x) => x.pricePerKwh)) : 0;
    const inflightValue = inflight.reduce((s, x) => s + x.totalCredits, 0);
    const fillRate = all.length ? settled.length / all.length : 0;
    const todayEarned = settled.filter((x) => isToday(ts(x))).reduce((s, x) => s + x.totalCredits, 0);

    return {
      all, settled, inflight, failed,
      equity, volume, fillPrices, fillLabels,
      energySold, totalEarned, vwap, bestFill, inflightValue, fillRate, todayEarned,
    };
  }, [trades]);

  const rows =
    filter === "settled" ? m.settled :
    filter === "inflight" ? m.inflight :
    filter === "failed" ? m.failed :
    m.all;

  const filters: { id: FilterId; label: string; n: number }[] = [
    { id: "all", label: "All", n: m.all.length },
    { id: "settled", label: "Settled", n: m.settled.length },
    { id: "inflight", label: "In-flight", n: m.inflight.length },
    { id: "failed", label: "Failed", n: m.failed.length },
  ];

  const mkt = clearingPrice ?? m.fillPrices.at(-1) ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Portfolio hero ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Realized earnings
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums text-neutral-900">
                {m.totalEarned.toFixed(2)}
              </span>
              <span className="text-sm font-medium text-neutral-400">cr</span>
              <span
                className={`ml-1 text-sm font-semibold tabular-nums ${
                  m.todayEarned > 0 ? "text-green-600" : "text-neutral-400"
                }`}
              >
                {m.todayEarned > 0 ? `▲ +${m.todayEarned.toFixed(2)} today` : "— flat today"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <HeroStat label="Energy sold" value={`${m.energySold.toFixed(2)}`} unit="kWh" />
            <HeroStat label="Avg fill (VWAP)" value={m.vwap.toFixed(3)} unit="cr/kWh" />
            <HeroStat label="Best fill" value={m.bestFill.toFixed(2)} unit="cr/kWh" />
            <HeroStat label="Fill rate" value={`${(m.fillRate * 100).toFixed(0)}`} unit="%" />
          </div>
        </div>
      </div>

      {/* ── KPI ticker ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Total earned" value={m.totalEarned} unit="cr" color="#16a34a" spark={m.equity} sparkColor="#16a34a" />
        <KpiTile label="Volume sold" value={m.energySold} unit="kWh" color="#2b6cb0" spark={m.volume} sparkColor="#2b6cb0" />
        <KpiTile label="Avg realized price" value={m.vwap} unit="cr/kWh" color="#7c3aed" decimals={3} spark={m.fillPrices} sparkColor="#7c3aed" />
        <KpiTile label="In-flight value" value={m.inflightValue} unit="cr" color="#d69e2e" decimals={2} />
      </div>

      {/* ── Charts: equity curve + fills vs market ─────────────────── */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Equity curve"
          actions={<span className="hidden text-xs text-neutral-400 sm:inline">cumulative credits · {m.settled.length} fills</span>}
        >
          {m.equity.length < 2 ? (
            <DeskWait note="Your cumulative earnings will chart here as trades settle." />
          ) : (
            <LiveChart
              height={230}
              yUnit="cr"
              xLabels={m.fillLabels}
              series={[{ key: "equity", label: "Cumulative earned", color: "#16a34a", points: m.equity }]}
            />
          )}
        </Card>

        <Card
          title="Fills vs market"
          actions={<span className="hidden text-xs text-neutral-400 sm:inline">cr/kWh · mkt {mkt.toFixed(2)}</span>}
        >
          {m.fillPrices.length < 2 ? (
            <DeskWait note="Each settled fill price will plot against the market clearing price." />
          ) : (
            <LiveChart
              height={230}
              yUnit="cr"
              baseZero={false}
              area={false}
              xLabels={m.fillLabels}
              series={[
                { key: "fill", label: "Your fills", color: "#7c3aed", points: m.fillPrices },
                { key: "mkt", label: "Market", color: "#a8a29e", points: m.fillPrices.map(() => mkt) },
              ]}
            />
          )}
        </Card>
      </div>

      {/* ── Fills ledger ───────────────────────────────────────────── */}
      <Card
        title="Fills ledger"
        actions={
          <div className="inline-flex gap-1 rounded-lg border border-neutral-200 bg-neutral-100/70 p-0.5">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  filter === f.id ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5" : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {f.label} <span className="tabular-nums text-neutral-400">{f.n}</span>
              </button>
            ))}
          </div>
        }
      >
        <Table
          head={["Time", "Side", "Qty kWh", "Price cr/kWh", "Total cr", "vs Mkt", "Status", "Anchor"]}
          rows={rows.length}
          empty="No fills in this view yet."
        >
          {rows.map((x) => {
            const spread = clearingPrice != null ? x.pricePerKwh - clearingPrice : null;
            return (
              <tr key={x._id}>
                <Td className="text-xs text-neutral-500">{hhmm(ts(x))}</Td>
                <Td>
                  <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-green-700 bg-green-50">SELL</span>
                </Td>
                <Td className="tabular-nums">{x.quantityKwh.toFixed(2)}</Td>
                <Td className="tabular-nums">{x.pricePerKwh.toFixed(2)}</Td>
                <Td className="tabular-nums font-medium text-leaf">+{x.totalCredits.toFixed(2)}</Td>
                <Td className="tabular-nums text-xs">
                  {spread == null || Math.abs(spread) < 1e-9 ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    <span className={spread >= 0 ? "text-green-600" : "text-red-500"}>
                      {spread >= 0 ? "▲" : "▼"} {Math.abs(spread).toFixed(2)}
                    </span>
                  )}
                </Td>
                <Td><StatusBadge value={x.status} /></Td>
                <Td><TxLink hash={x.anchorTxHash} /></Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

function HeroStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-neutral-800">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-neutral-400">{unit}</span>}
      </div>
    </div>
  );
}

function DeskWait({ note }: { note: string }) {
  return (
    <div className="flex h-[230px] items-center justify-center px-6 text-center text-sm text-neutral-400">
      {note}
    </div>
  );
}
