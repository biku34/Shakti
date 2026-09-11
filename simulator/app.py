"""
Flask control service for the smart-meter simulator (§7).

Runs a background loop that advances a simulated clock and POSTs bidirectional
readings to the Next.js ingestion endpoint (SM-7). Exposes a small control API
to start/stop, step once, inject/clear faults (SM-6), and inspect state.

  POST /start                 begin the auto-push loop
  POST /stop                  pause it
  POST /tick                  push one batch immediately (manual step)
  POST /fault {meterCode,fault}  set fault: inflate|night|offline_report|clear
  GET  /state                 current sim time, running flag, meter faults
  GET  /health                liveness

Fault demo (Appendix B): POST /fault to arm an anomaly, then /tick or /start.
"""
import threading
import time

import requests
from flask import Flask, jsonify, request

import config
from simulator import SimState, build_batch, load_meters

app = Flask(__name__)
state = SimState(meters=load_meters(config.MANIFEST_PATH))
_lock = threading.Lock()
_thread: threading.Thread | None = None


def push_batch() -> dict:
    with _lock:
        batch = build_batch(state, config.INTERVAL_MINUTES)
        # Advance the simulated clock (SM-5 time acceleration).
        from datetime import timedelta
        state.sim_time = state.sim_time + timedelta(minutes=config.ACCELERATION)

    try:
        resp = requests.post(
            config.INGEST_URL,
            json={"batch": batch},
            headers={"Authorization": f"Bearer {config.SIM_SERVICE_TOKEN}"},
            timeout=10,
        )
        return {"status": resp.status_code, "body": _safe_json(resp), "sent": len(batch)}
    except requests.RequestException as exc:
        return {"status": "error", "error": str(exc), "sent": len(batch)}


def _safe_json(resp):
    try:
        return resp.json()
    except ValueError:
        return resp.text[:500]


def _loop():
    while True:
        with _lock:
            running = state.running
        if not running:
            time.sleep(0.25)
            continue
        result = push_batch()
        app.logger.info("pushed batch: %s", result)
        time.sleep(config.TICK_SECONDS)


@app.get("/health")
def health():
    return jsonify(ok=True, meters=len(state.meters))


@app.get("/state")
def get_state():
    return jsonify(
        running=state.running,
        simTime=state.sim_time.isoformat(),
        acceleration=config.ACCELERATION,
        intervalMinutes=config.INTERVAL_MINUTES,
        meters=[
            {"code": m.code, "feeder": m.feeder_code, "capacityKw": m.solar_capacity_kw,
             "status": m.status, "fault": m.fault}
            for m in state.meters
        ],
    )


@app.post("/start")
def start():
    state.running = True
    return jsonify(ok=True, running=True)


@app.post("/stop")
def stop():
    state.running = False
    return jsonify(ok=True, running=False)


@app.post("/tick")
def tick():
    return jsonify(ok=True, result=push_batch())


@app.post("/fault")
def fault():
    data = request.get_json(force=True, silent=True) or {}
    code = data.get("meterCode")
    fault_type = data.get("fault")  # inflate | night | offline_report | clear
    target = next((m for m in state.meters if m.code == code), None)
    if not target:
        return jsonify(ok=False, error=f"unknown meter {code}"), 404
    if fault_type in (None, "clear"):
        target.fault = None
        target.status = "online"
    else:
        target.fault = fault_type
    return jsonify(ok=True, meter=code, fault=target.fault)


if __name__ == "__main__":
    _thread = threading.Thread(target=_loop, daemon=True)
    _thread.start()
    app.run(host=config.HOST, port=config.PORT)
