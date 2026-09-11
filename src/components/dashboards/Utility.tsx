"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Card, Stat, Table, Td, StatusBadge, Tabs, useApi } from "@/components/ui";
import {
  classifyCongestion,
  utilisationPct,
  CONGESTION_LABEL,
  CONGESTION_LEVELS,
  type CongestionLevel,
} from "@/lib/congestion";
import { buildInitialZones, type Zone } from "@/lib/zones";
import type { TransferOption } from "@/lib/transfer";

// Leaflet touches `window`, so load the map client-side only (no SSR).
const CongestionMap = dynamic(() => import("@/components/CongestionMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-xl border border-neutral-200 text-sm text-neutral-400">
      Loading map…
    </div>
  ),
});

type Feeder = {
  _id: string;
  code: string;
  name: string;
  capacityKw: number;
  currentLoadKw: number;
  congestionLevel: CongestionLevel;
  meterCount: number;
  location: { lat: number; lng: number };
};
type Settlement = {
  feederId: string;
  trades: number;
  energyKwh: number;
  credits: number;
  avgPricePerKwh: number;
  sellers: number;
  buyers: number;
  lastSettledAt: string | null;
};

const TABS = [
  { id: "monitor", label: "Feeder Monitor" },
  { id: "congestion", label: "Congestion Map" },
  { id: "settlements", label: "Settlements" },
];

const DOT_COLOR: Record<CongestionLevel, string> = {
  low: "#38a169",
  risky: "#dd6b20",
  high: "#e53e3e",
  critical: "#9b2c2c",
};

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />;
}

// Derive the congestion band live from the current load vs capacity so the
// dashboard always reflects the <70 / 70–90 / 90–100 / >100 scheme.
function levelOf(f: { currentLoadKw: number; capacityKw: number }): CongestionLevel {
  return classifyCongestion(f.currentLoadKw, f.capacityKw);
}

// Compact relative time for the last settlement on a feeder ("3m ago"), or a
// dash when the feeder has no settled trades yet.
function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function UtilityDashboard() {
  const feeders = useApi<Feeder[]>("/api/utility/feeders", 4000);
  const settlements = useApi<Settlement[]>("/api/utility/settlements", 5000);
  const list = feeders.data ?? [];
  const byId = new Map((settlements.data ?? []).map((s) => [s.feederId, s]));

  // Only GNR-F-011 is a live/dynamic DB feeder. Every other feeder shown in the
  // monitor is a demo zone that shares its data with the congestion map — a load
  // transfer done on the map updates the monitor list too (single source state).
  const [zones, setZones] = useState<Zone[]>(() => buildInitialZones());
  function handleTransfer(srcId: string, opt: TransferOption<Zone>) {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id === srcId) return { ...z, loadKw: Number((z.loadKw - opt.transferKw).toFixed(1)) };
        if (z.id === opt.target.id) return { ...z, loadKw: Number((z.loadKw + opt.transferKw).toFixed(1)) };
        return z;
      }),
    );
  }
  const realFeeders = list.filter((f) => f.code === "GNR-F-011");
  const zoneRows: Feeder[] = zones.map((z) => ({
    _id: z.id,
    code: z.code,
    name: z.area,
    capacityKw: z.capacityKw,
    currentLoadKw: z.loadKw,
    congestionLevel: classifyCongestion(z.loadKw, z.capacityKw),
    meterCount: 0,
    location: { lat: z.center[0], lng: z.center[1] },
  }));
  const monitorList = [...realFeeders, ...zoneRows];

  const totalCap = monitorList.reduce((s, f) => s + f.capacityKw, 0);
  const totalLoad = monitorList.reduce((s, f) => s + f.currentLoadKw, 0);
  const totalMeters = monitorList.reduce((s, f) => s + (f.meterCount ?? 0), 0);
  const counts = CONGESTION_LEVELS.reduce(
    (acc, lvl) => ({ ...acc, [lvl]: monitorList.filter((f) => levelOf(f) === lvl).length }),
    {} as Record<CongestionLevel, number>,
  );
  const settled = settlements.data ?? [];
  // Settlements list every DB feeder (`list`), so its meter total is summed over
  // `list` — not the monitor's `totalMeters`, which counts transfer-demo zones.
  const feederMeters = list.reduce((s, f) => s + (f.meterCount ?? 0), 0);
  const localEnergy = settled.reduce((s, x) => s + x.energyKwh, 0);
  const totalCredits = settled.reduce((s, x) => s + x.credits, 0);
  const totalTrades = settled.reduce((s, x) => s + x.trades, 0);
  const totalSellers = settled.reduce((s, x) => s + x.sellers, 0);
  const totalBuyers = settled.reduce((s, x) => s + x.buyers, 0);
  const avgPrice = localEnergy > 0 ? totalCredits / localEnergy : 0;
  // FR-9.2: crude localized-trade transmission-loss estimate (~6% avoided on local kWh).
  const lossAvoided = localEnergy * 0.06;

  return (
    <Tabs tabs={TABS}>
      {(active) => (
        <>
          {active === "monitor" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Stat label="Feeders" value={monitorList.length} />
                <Stat label="Meters" value={totalMeters} />
                <Stat label="Total capacity" value={totalCap.toFixed(0)} unit="kW" />
                <Stat label="Solar output" value={totalLoad.toFixed(1)} unit="kW" accent="solar" />
                <Stat label="Utilisation" value={totalCap ? ((totalLoad / totalCap) * 100).toFixed(1) : "—"} unit="%" />
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_4fr]">
                <Card title="Congestion status">
                  <div className="flex flex-col gap-2 text-sm">
                    {CONGESTION_LEVELS.map((lvl) => (
                      <span key={lvl} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5">
                        <Dot color={DOT_COLOR[lvl]} />
                        <span className="capitalize text-neutral-600">{CONGESTION_LABEL[lvl]}</span>
                        <span className="ml-auto tabular-nums font-semibold text-neutral-900">{counts[lvl]}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-neutral-400">
                    Bands by live load vs capacity: &lt;70% low congested · 70–90% risky · 90–100% high · &gt;100% critical.
                  </p>
                </Card>

                <Card title="Feeders">
                  <Table head={["Code", "Name", "Meters", "Solar output kW", "Capacity kW", "Load %", "Congestion"]} rows={monitorList.length}>
                    {monitorList.map((f) => {
                      const lvl = levelOf(f);
                      return (
                        <tr key={f._id}>
                          <Td className="font-mono text-xs">{f.code}</Td>
                          <Td>{f.name}</Td>
                          <Td className="tabular-nums">{f.meterCount ?? 0}</Td>
                          <Td className="tabular-nums">{f.currentLoadKw.toFixed(1)}</Td>
                          <Td className="tabular-nums">{f.capacityKw}</Td>
                          <Td className="tabular-nums">{utilisationPct(f.currentLoadKw, f.capacityKw).toFixed(1)}%</Td>
                          <Td><StatusBadge value={lvl} label={CONGESTION_LABEL[lvl]} /></Td>
                        </tr>
                      );
                    })}
                  </Table>
                </Card>
              </div>
            </div>
          )}

          {active === "congestion" && (
            <div className="space-y-6">
              <Card title="Gandhinagar feeder congestion — live map">
                <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
                  {CONGESTION_LEVELS.map((lvl) => (
                    <span key={lvl} className="flex items-center gap-1.5 capitalize">
                      <Dot color={DOT_COLOR[lvl]} /> {CONGESTION_LABEL[lvl]}
                    </span>
                  ))}
                  <span className="text-neutral-400">Shaded area ∝ feeder coverage · click a zone for detail</span>
                </div>
                <CongestionMap feeders={realFeeders} zones={zones} onTransfer={handleTransfer} />
              </Card>
            </div>
          )}

          {active === "settlements" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Stat label="Local energy traded" value={localEnergy.toFixed(2)} unit="kWh" accent="leaf" />
                <Stat label="Settled trades" value={totalTrades} />
                <Stat label="Metering points" value={feederMeters} />
                <Stat label="Avg price" value={avgPrice.toFixed(3)} unit="cr/kWh" accent="solar" />
                <Stat label="Total settled credits" value={totalCredits.toFixed(2)} unit="cr" />
              </div>

              <Card title="Settlements by feeder">
                <Table
                  head={[
                    "Code",
                    "Name",
                    "Meters",
                    "Sellers",
                    "Buyers",
                    "Settled trades",
                    "Energy kWh",
                    "Avg price cr/kWh",
                    "Credits revenue",
                    "Last settled",
                  ]}
                  rows={list.length}
                >
                  {list.map((f) => {
                    const s = byId.get(f._id);
                    const energy = s?.energyKwh ?? 0;
                    const energyShare = localEnergy > 0 ? (energy / localEnergy) * 100 : 0;
                    return (
                      <tr key={f._id}>
                        <Td className="font-mono text-xs">{f.code}</Td>
                        <Td>{f.name}</Td>
                        <Td className="tabular-nums">{f.meterCount ?? 0}</Td>
                        <Td className="tabular-nums">{s?.sellers ?? 0}</Td>
                        <Td className="tabular-nums">{s?.buyers ?? 0}</Td>
                        <Td className="tabular-nums">{s?.trades ?? 0}</Td>
                        <Td className="tabular-nums">
                          <div className="flex items-center gap-2">
                            <span>{energy.toFixed(2)}</span>
                            <span className="hidden text-[11px] text-neutral-400 lg:inline">{energyShare.toFixed(0)}%</span>
                          </div>
                        </Td>
                        <Td className="tabular-nums">{(s?.avgPricePerKwh ?? 0).toFixed(3)}</Td>
                        <Td className="tabular-nums font-semibold text-neutral-900">{(s?.credits ?? 0).toFixed(2)}</Td>
                        <Td className="text-xs text-neutral-500">{fmtWhen(s?.lastSettledAt)}</Td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-neutral-200 font-semibold">
                    <Td className="text-xs uppercase tracking-wide text-neutral-500">Total</Td>
                    <Td className="text-neutral-400">{list.length} feeders</Td>
                    <Td className="tabular-nums">{feederMeters}</Td>
                    <Td className="tabular-nums">{totalSellers}</Td>
                    <Td className="tabular-nums">{totalBuyers}</Td>
                    <Td className="tabular-nums">{totalTrades}</Td>
                    <Td className="tabular-nums">{localEnergy.toFixed(2)}</Td>
                    <Td className="tabular-nums">{avgPrice.toFixed(3)}</Td>
                    <Td className="tabular-nums text-neutral-900">{totalCredits.toFixed(2)}</Td>
                    <Td>{""}</Td>
                  </tr>
                </Table>
              </Card>

              <Card title="Localised-trade impact">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Stat label="Est. transmission loss avoided" value={lossAvoided.toFixed(2)} unit="kWh" accent="leaf" />
                  <Stat
                    label="Avg credits per meter"
                    value={feederMeters ? (totalCredits / feederMeters).toFixed(2) : "—"}
                    unit="cr"
                  />
                </div>
                <p className="mt-3 text-xs text-neutral-400">
                  Credits revenue is settled peer-to-peer value cleared on each feeder. Energy share and avg price are
                  derived from settled trades; transmission loss avoided assumes ~6% saved on locally cleared kWh.
                </p>
              </Card>
            </div>
          )}
        </>
      )}
    </Tabs>
  );
}
