"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Card, Stat, Badge, StatusBadge, Btn, useApi, useToast, inputClass } from "@/components/ui";

type SimMeter = {
  code: string;
  feeder: string;
  capacityKw: number;
  type: "prosumer" | "consumer";
  owner: string;
  running: boolean;
  status: "online" | "offline";
  fault: string | null;
};
type SimState = {
  simTime: string;
  acceleration: number;
  intervalMinutes: number;
  tickSeconds: number;
  runningCount: number;
  meters: SimMeter[];
};

export default function SmartSimulatorPage() {
  const { show, node } = useToast();
  const { data, refetch } = useApi<SimState>("/api/smart/state", 2000);
  const meters = data?.meters ?? [];

  async function post(path: string, body?: unknown) {
    try {
      await api(path, { method: "POST", body });
      refetch();
    } catch (e) {
      show(e instanceof Error ? e.message : "Request failed");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-2xl">⚡</span>
        <h1 className="text-xl font-bold text-neutral-900">Smart-Meter Simulator</h1>
      </div>
      <p className="mb-6 text-sm text-neutral-500">
        Start any meter to stream bidirectional readings straight into the platform — that meter&apos;s
        owner dashboard updates live, others stay idle.
      </p>

      {/* Controls + clock */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                (data?.runningCount ?? 0) > 0 ? "animate-pulse bg-green-500" : "bg-neutral-300"
              }`}
            />
            {(data?.runningCount ?? 0) > 0
              ? `Streaming — ${data?.runningCount} meter${data?.runningCount === 1 ? "" : "s"}`
              : "Idle — no meters running"}
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => post("/api/smart/meter", { all: true, running: true })}>Start all</Btn>
            <Btn variant="danger" onClick={() => post("/api/smart/meter", { all: true, running: false })}>
              Stop all
            </Btn>
            <Btn variant="ghost" onClick={() => post("/api/smart/tick")}>
              Push one tick
            </Btn>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Stat label="Running meters" value={`${data?.runningCount ?? 0} / ${meters.length}`} accent="leaf" />
          <Stat
            label="Sim clock"
            value={<span className="text-base">{data ? new Date(data.simTime).toLocaleTimeString() : "—"}</span>}
          />
          <Stat label="Acceleration" value={data?.acceleration ?? "—"} unit="min/tick" />
          <Stat label="Interval" value={data?.intervalMinutes ?? "—"} unit="min" />
        </div>
      </Card>

      {/* Fault injection */}
      <Card title="Fault injection (fraud demo)" className="mb-6">
        <FaultPanel meters={meters} onApply={(code, fault) => post("/api/smart/fault", { meterCode: code, fault })} />
        <p className="mt-3 text-xs text-neutral-400">
          Alerts surface on the Regulator → Fraud Dashboard within a couple of ticks.
        </p>
      </Card>

      {/* Meters */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Meters — choose which to run
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {meters.map((m) => (
          <MeterCard
            key={m.code}
            m={m}
            onToggle={() => post("/api/smart/meter", { meterCode: m.code, running: !m.running })}
          />
        ))}
        {meters.length === 0 && (
          <p className="text-sm text-neutral-400">No meters in the manifest.</p>
        )}
      </div>

      {node}
    </main>
  );
}

function MeterCard({ m, onToggle }: { m: SimMeter; onToggle: () => void }) {
  const isProsumer = m.type === "prosumer";
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm transition ${
        m.running ? "border-green-300 bg-white" : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-semibold text-neutral-900">{m.code}</div>
          <div className="text-xs text-neutral-500">{m.owner || m.feeder}</div>
        </div>
        <Badge tone={isProsumer ? "yellow" : "blue"}>
          {isProsumer ? "☀ Prosumer" : "🔌 Consumer"}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge>{isProsumer ? `${m.capacityKw} kW solar` : "Load-only"}</Badge>
        <Badge>{m.feeder}</Badge>
        <StatusBadge value={m.status} />
        {m.fault && <Badge tone="orange">{m.fault}</Badge>}
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-3">
        {m.running ? (
          <Btn variant="danger" size="sm" onClick={onToggle}>
            ■ Stop
          </Btn>
        ) : (
          <Btn size="sm" onClick={onToggle}>
            ▶ Start
          </Btn>
        )}
        <span className="ml-2 text-xs font-medium text-neutral-500">
          {m.running ? "Running" : "Stopped"}
        </span>
      </div>
    </div>
  );
}

function FaultPanel({
  meters,
  onApply,
}: {
  meters: SimMeter[];
  onApply: (code: string, fault: string) => void;
}) {
  const [code, setCode] = useState("");
  const [fault, setFault] = useState("inflate");
  const meterCode = code || meters[0]?.code || "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={inputClass} value={meterCode} onChange={(e) => setCode(e.target.value)}>
        {meters.map((m) => (
          <option key={m.code} value={m.code}>
            {m.code}
          </option>
        ))}
      </select>
      <select className={inputClass} value={fault} onChange={(e) => setFault(e.target.value)}>
        <option value="inflate">inflate → over-capacity (R-03)</option>
        <option value="night">night generation (R-05)</option>
        <option value="offline_report">offline-but-reporting (R-04)</option>
      </select>
      <Btn variant="ghost" size="sm" onClick={() => meterCode && onApply(meterCode, fault)}>
        Arm fault
      </Btn>
      <Btn variant="ghost" size="sm" onClick={() => meterCode && onApply(meterCode, "clear")}>
        Clear
      </Btn>
    </div>
  );
}
