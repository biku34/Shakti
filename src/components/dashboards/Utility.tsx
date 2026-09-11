"use client";

import { Card, Stat, Table, Td, StatusBadge, Tabs, useApi } from "@/components/ui";

type Feeder = {
  _id: string;
  code: string;
  name: string;
  capacityKw: number;
  currentLoadKw: number;
  congestionLevel: string;
};
type Settlement = { feederId: string; trades: number; energyKwh: number; credits: number };

const TABS = [
  { id: "monitor", label: "Feeder Monitor" },
  { id: "congestion", label: "Congestion Map" },
  { id: "grid", label: "Grid Exchange" },
  { id: "settlements", label: "Settlements" },
];

const BAR_COLOR: Record<string, string> = { low: "bg-leaf", medium: "bg-amber-400", high: "bg-red-500" };

export default function UtilityDashboard() {
  const feeders = useApi<Feeder[]>("/api/utility/feeders", 4000);
  const settlements = useApi<Settlement[]>("/api/utility/settlements", 5000);
  const list = feeders.data ?? [];
  const byId = new Map((settlements.data ?? []).map((s) => [s.feederId, s]));

  const totalCap = list.reduce((s, f) => s + f.capacityKw, 0);
  const totalLoad = list.reduce((s, f) => s + f.currentLoadKw, 0);
  const localEnergy = (settlements.data ?? []).reduce((s, x) => s + x.energyKwh, 0);
  // FR-9.2: crude localized-trade transmission-loss estimate (~6% avoided on local kWh).
  const lossAvoided = localEnergy * 0.06;

  return (
    <Tabs tabs={TABS}>
      {(active) => (
        <>
          {active === "monitor" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Feeders" value={list.length} />
                <Stat label="Total capacity" value={totalCap.toFixed(0)} unit="kW" />
                <Stat label="Current load" value={totalLoad.toFixed(1)} unit="kW" accent="grid" />
                <Stat label="Utilisation" value={totalCap ? ((totalLoad / totalCap) * 100).toFixed(1) : "—"} unit="%" />
              </div>
              <Card title="Feeders">
                <Table head={["Code", "Name", "Load kW", "Capacity kW", "Congestion"]} rows={list.length}>
                  {list.map((f) => (
                    <tr key={f._id}>
                      <Td className="font-mono text-xs">{f.code}</Td>
                      <Td>{f.name}</Td>
                      <Td className="tabular-nums">{f.currentLoadKw.toFixed(1)}</Td>
                      <Td className="tabular-nums">{f.capacityKw}</Td>
                      <Td><StatusBadge value={f.congestionLevel} /></Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          )}

          {active === "congestion" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((f) => {
                const pct = Math.min(100, (f.currentLoadKw / Math.max(f.capacityKw, 1)) * 100);
                return (
                  <Card key={f._id} title={f.code}>
                    <p className="mb-2 text-xs text-neutral-400">{f.name}</p>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div className={`h-full ${BAR_COLOR[f.congestionLevel] ?? "bg-neutral-400"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <StatusBadge value={f.congestionLevel} />
                      <span className="tabular-nums text-neutral-500">{pct.toFixed(0)}% of {f.capacityKw} kW</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {active === "grid" && (
            <Card title="Net grid exchange per feeder">
              <Table head={["Feeder", "Net load kW", "Direction", "Congestion"]} rows={list.length}>
                {list.map((f) => (
                  <tr key={f._id}>
                    <Td className="font-mono text-xs">{f.code}</Td>
                    <Td className="tabular-nums">{f.currentLoadKw.toFixed(1)}</Td>
                    <Td>{f.currentLoadKw > 0 ? <span className="text-grid">↓ importing</span> : <span className="text-leaf">↑ exporting</span>}</Td>
                    <Td><StatusBadge value={f.congestionLevel} /></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "settlements" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Local energy traded" value={localEnergy.toFixed(2)} unit="kWh" accent="leaf" />
                <Stat label="Est. transmission loss avoided" value={lossAvoided.toFixed(2)} unit="kWh" accent="leaf" />
                <Stat label="Total settled credits" value={(settlements.data ?? []).reduce((s, x) => s + x.credits, 0).toFixed(2)} unit="cr" />
              </div>
              <Card title="Settlements by feeder">
                <Table head={["Feeder", "Settled trades", "Energy kWh", "Credits"]} rows={list.length}>
                  {list.map((f) => {
                    const s = byId.get(f._id);
                    return (
                      <tr key={f._id}>
                        <Td className="font-mono text-xs">{f.code}</Td>
                        <Td className="tabular-nums">{s?.trades ?? 0}</Td>
                        <Td className="tabular-nums">{(s?.energyKwh ?? 0).toFixed(2)}</Td>
                        <Td className="tabular-nums">{(s?.credits ?? 0).toFixed(2)}</Td>
                      </tr>
                    );
                  })}
                </Table>
              </Card>
            </div>
          )}
        </>
      )}
    </Tabs>
  );
}
