"""
Bidirectional smart-meter simulation core (§7.2).

Models a solar generation curve (zero at night, peak midday) scaled by each
meter's capacity and a randomized irradiance factor, plus a household
consumption profile with morning/evening peaks. Derives import/export as a real
bidirectional meter would (SM-4), and supports fault injection for fraud demos
(SM-6). Physical state is deterministic per (meter, sim-time) apart from noise.
"""
import json
import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


@dataclass
class Meter:
    code: str
    feeder_code: str
    solar_capacity_kw: float
    status: str = "online"          # online | offline (fault injection)
    fault: str | None = None        # None | inflate | night | offline_report | duplicate


@dataclass
class SimState:
    meters: list[Meter] = field(default_factory=list)
    sim_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc).replace(
        hour=6, minute=0, second=0, microsecond=0))
    running: bool = False


def load_meters(manifest_path: str) -> list[Meter]:
    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    meters: list[Meter] = []
    for feeder in manifest["feeders"]:
        for p in feeder["prosumers"]:
            meters.append(Meter(
                code=p["meterCode"],
                feeder_code=feeder["code"],
                solar_capacity_kw=float(p["solarCapacityKw"]),
            ))
    return meters


def solar_factor(hour_float: float) -> float:
    """Bell-shaped solar output 0..1 across the day; zero outside ~06:00–18:00."""
    if hour_float < 6 or hour_float > 18:
        return 0.0
    # Peak at 12:00; half-sine over the daylight window.
    return max(0.0, math.sin((hour_float - 6) / 12 * math.pi))


def consumption_kwh(hour_float: float, interval_hours: float) -> float:
    """Household load with morning (07–09) and evening (18–22) peaks."""
    base = 0.2  # kW baseline
    morning = 0.6 * math.exp(-((hour_float - 8) ** 2) / 2)
    evening = 0.9 * math.exp(-((hour_float - 20) ** 2) / 4)
    load_kw = base + morning + evening + random.uniform(-0.05, 0.05)
    return max(0.0, load_kw) * interval_hours


def build_reading(meter: Meter, sim_time: datetime, interval_minutes: int) -> dict:
    interval_hours = interval_minutes / 60.0
    hour_float = sim_time.hour + sim_time.minute / 60.0

    irradiance = round(solar_factor(hour_float) * random.uniform(0.8, 1.0), 3)
    generation = round(meter.solar_capacity_kw * irradiance * interval_hours, 4)
    consumption = round(consumption_kwh(hour_float, interval_hours), 4)
    status = meter.status

    # ─── Fault injection (SM-6) for fraud demos ───────────────────────
    if meter.fault == "inflate":
        # Report generation well above physical capacity → R-03.
        generation = round(meter.solar_capacity_kw * interval_hours * 1.8, 4)
    elif meter.fault == "night":
        # Force generation regardless of hour → R-05 during night.
        generation = round(meter.solar_capacity_kw * 0.5 * interval_hours, 4)
        irradiance = 0.0
    elif meter.fault == "offline_report":
        # Claim generation while offline → R-04.
        status = "offline"
        generation = round(meter.solar_capacity_kw * 0.6 * interval_hours, 4)

    export = round(max(0.0, generation - consumption), 4)
    imp = round(max(0.0, consumption - generation), 4)

    return {
        "meterId": meter.code,
        "feederId": meter.feeder_code,
        "timestamp": sim_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "intervalMinutes": interval_minutes,
        "generationKwh": generation,
        "consumptionKwh": consumption,
        "importKwh": imp,
        "exportKwh": export,
        "irradianceFactor": irradiance,
        "meterStatus": status,
    }


def build_batch(state: SimState, interval_minutes: int) -> list[dict]:
    return [build_reading(m, state.sim_time, interval_minutes) for m in state.meters]
