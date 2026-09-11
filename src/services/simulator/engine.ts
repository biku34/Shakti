/**
 * In-process smart-meter simulator (§7.2), ported from the standalone Python
 * service to run inside the Next.js server and feed the ingestion core directly.
 *
 * Models a solar generation curve (zero at night, peak midday) scaled by each
 * meter's capacity and a randomized irradiance factor, plus a household
 * consumption profile with morning/evening peaks. Derives import/export as a
 * real bidirectional meter would (SM-4), and supports fault injection for fraud
 * demos (SM-6).
 *
 * Per-meter start (SM-*): each meter has its own `running` flag — the tick loop
 * emits readings ONLY for running meters, so starting one meter streams data to
 * that meter alone and its owner's dashboard updates in isolation.
 *
 * The engine is a singleton cached on globalThis so it survives Next.js HMR and
 * is shared across all API routes in the same server process.
 */
import fs from "node:fs";
import path from "node:path";
import { ingestBatch, type IngestReading } from "@/services/ingest/ingestReadings";

export type FaultType = "inflate" | "night" | "offline_report";
export type MeterType = "prosumer" | "consumer";

export type SimMeter = {
  code: string;
  feederCode: string;
  solarCapacityKw: number;
  meterType: MeterType;
  owner: string;
  running: boolean; // included in the tick loop when true
  status: "online" | "offline";
  fault: FaultType | null;
};

type SimConfig = {
  intervalMinutes: number;
  tickSeconds: number;
  acceleration: number; // sim-minutes advanced per tick
  manifestPath: string;
};

function config(): SimConfig {
  const numEnv = (name: string, fallback: number) => {
    const v = process.env[name];
    const n = v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    intervalMinutes: numEnv("SIM_INTERVAL_MINUTES", 15),
    tickSeconds: numEnv("SIM_TICK_SECONDS", 2),
    acceleration: numEnv("SIM_ACCELERATION", 96),
    manifestPath:
      process.env.SIM_MANIFEST || path.join(process.cwd(), "data", "gandhinagar.json"),
  };
}

// ─── Physical model (ported from simulator.py) ───────────────────────────
/** Bell-shaped solar output 0..1 across the day; zero outside ~06:00–18:00. */
function solarFactor(hourFloat: number): number {
  if (hourFloat < 6 || hourFloat > 18) return 0;
  return Math.max(0, Math.sin(((hourFloat - 6) / 12) * Math.PI));
}

/** Household load with morning (07–09) and evening (18–22) peaks. */
function consumptionKwh(hourFloat: number, intervalHours: number): number {
  const base = 0.2; // kW baseline
  const morning = 0.6 * Math.exp(-((hourFloat - 8) ** 2) / 2);
  const evening = 0.9 * Math.exp(-((hourFloat - 20) ** 2) / 4);
  const loadKw = base + morning + evening + (Math.random() * 0.1 - 0.05);
  return Math.max(0, loadKw) * intervalHours;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function buildReading(m: SimMeter, simTime: Date, intervalMinutes: number): IngestReading {
  const intervalHours = intervalMinutes / 60;
  const hourFloat = simTime.getUTCHours() + simTime.getUTCMinutes() / 60;

  let irradiance = round(solarFactor(hourFloat) * (0.8 + Math.random() * 0.2), 3);
  let generation = round(m.solarCapacityKw * irradiance * intervalHours, 4);
  const consumption = round(consumptionKwh(hourFloat, intervalHours), 4);
  let status = m.status;

  // ─── Fault injection (SM-6) for fraud demos ───────────────────────
  if (m.fault === "inflate") {
    // Report generation well above physical capacity → R-03.
    generation = round(m.solarCapacityKw * intervalHours * 1.8, 4);
  } else if (m.fault === "night") {
    // Force generation regardless of hour → R-05 during night.
    generation = round(m.solarCapacityKw * 0.5 * intervalHours, 4);
    irradiance = 0;
  } else if (m.fault === "offline_report") {
    // Claim generation while offline → R-04.
    status = "offline";
    generation = round(m.solarCapacityKw * 0.6 * intervalHours, 4);
  }

  const exportKwh = round(Math.max(0, generation - consumption), 4);
  const importKwh = round(Math.max(0, consumption - generation), 4);

  return {
    meterId: m.code,
    feederId: m.feederCode,
    timestamp: simTime.toISOString().replace(".000Z", "Z"),
    intervalMinutes,
    generationKwh: generation,
    consumptionKwh: consumption,
    importKwh,
    exportKwh,
    irradianceFactor: irradiance,
    meterStatus: status,
  };
}

// ─── Manifest loading ────────────────────────────────────────────────────
function loadMeters(manifestPath: string): SimMeter[] {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const meters: SimMeter[] = [];
  for (const feeder of manifest.feeders ?? []) {
    for (const p of feeder.prosumers ?? []) {
      meters.push({
        code: p.meterCode,
        feederCode: feeder.code,
        solarCapacityKw: Number(p.solarCapacityKw),
        meterType: "prosumer",
        owner: p.name ?? "",
        running: false,
        status: "online",
        fault: null,
      });
    }
    for (const c of feeder.consumers ?? []) {
      meters.push({
        code: c.meterCode,
        feederCode: feeder.code,
        solarCapacityKw: 0,
        meterType: "consumer",
        owner: c.name ?? "",
        running: false,
        status: "online",
        fault: null,
      });
    }
  }
  return meters;
}

// ─── Engine (singleton) ──────────────────────────────────────────────────
class SimulatorEngine {
  cfg: SimConfig;
  meters: SimMeter[];
  simTime: Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  lastResult: unknown = null;

  constructor() {
    this.cfg = config();
    this.meters = loadMeters(this.cfg.manifestPath);
    // Start the simulated day at 06:00 UTC (sunrise), like the Python service.
    const d = new Date();
    d.setUTCHours(6, 0, 0, 0);
    this.simTime = d;
  }

  private ensureLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.autoTick();
    }, this.cfg.tickSeconds * 1000);
    // Don't keep the Node process alive solely for the sim loop.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Loop step: emit a batch only when at least one meter is running. */
  private async autoTick() {
    if (this.ticking) return;
    if (!this.meters.some((m) => m.running)) return;
    await this.tick();
  }

  /** Build + ingest one batch for the running meters, then advance the clock. */
  async tick(): Promise<{ sent: number; simTime: string; result?: unknown }> {
    if (this.ticking) return { sent: 0, simTime: this.simTime.toISOString() };
    this.ticking = true;
    try {
      const running = this.meters.filter((m) => m.running);
      const batch = running.map((m) => buildReading(m, this.simTime, this.cfg.intervalMinutes));
      // Advance the simulated clock (SM-5 time acceleration).
      this.simTime = new Date(this.simTime.getTime() + this.cfg.acceleration * 60_000);
      if (batch.length === 0) return { sent: 0, simTime: this.simTime.toISOString() };
      const result = await ingestBatch(batch);
      this.lastResult = result;
      return { sent: batch.length, simTime: this.simTime.toISOString(), result };
    } finally {
      this.ticking = false;
    }
  }

  setMeterRunning(code: string, running: boolean): SimMeter | null {
    const m = this.meters.find((x) => x.code === code);
    if (!m) return null;
    m.running = running;
    if (running) this.ensureLoop();
    return m;
  }

  setAllRunning(running: boolean) {
    for (const m of this.meters) m.running = running;
    if (running) this.ensureLoop();
  }

  setFault(code: string, fault: FaultType | "clear" | null): SimMeter | null {
    const m = this.meters.find((x) => x.code === code);
    if (!m) return null;
    if (fault === null || fault === "clear") {
      m.fault = null;
      m.status = "online";
    } else {
      m.fault = fault;
    }
    return m;
  }

  state() {
    return {
      simTime: this.simTime.toISOString(),
      acceleration: this.cfg.acceleration,
      intervalMinutes: this.cfg.intervalMinutes,
      tickSeconds: this.cfg.tickSeconds,
      runningCount: this.meters.filter((m) => m.running).length,
      meters: this.meters.map((m) => ({
        code: m.code,
        feeder: m.feederCode,
        capacityKw: m.solarCapacityKw,
        type: m.meterType,
        owner: m.owner,
        running: m.running,
        status: m.status,
        fault: m.fault,
      })),
    };
  }
}

// Reuse across HMR reloads so the tick loop and meter state persist.
const globalForSim = globalThis as unknown as { _simEngine?: SimulatorEngine };
export function getEngine(): SimulatorEngine {
  if (!globalForSim._simEngine) globalForSim._simEngine = new SimulatorEngine();
  return globalForSim._simEngine;
}
