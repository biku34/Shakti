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
from flask import Flask, jsonify, request, render_template_string

import config
from simulator import SimState, build_batch, load_meters

app = Flask(__name__)
state = SimState(meters=load_meters(config.MANIFEST_PATH))
_lock = threading.Lock()
_thread: threading.Thread | None = None


CONTROL_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Smart-Meter Simulator</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #f5f5f4; color: #1c1917; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #78716c; margin: 0 0 24px; font-size: 13px; }
  .card { background: #fff; border: 1px solid #e7e5e4; border-radius: 14px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 20px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-weight: 600; font-size: 13px; }
  .pill.on { background: #dcfce7; color: #166534; }
  .pill.off { background: #fee2e2; color: #991b1b; }
  .dot { width: 9px; height: 9px; border-radius: 999px; background: currentColor; }
  .dot.pulse { animation: pulse 1.2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  button { font: inherit; font-weight: 600; border: none; border-radius: 10px; padding: 12px 22px; cursor: pointer; transition: filter .15s; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button:hover:not(:disabled) { filter: brightness(.95); }
  .start { background: #16a34a; color: #fff; }
  .stop { background: #dc2626; color: #fff; }
  .ghost { background: #fff; border: 1px solid #d6d3d1; color: #44403c; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 10px; padding: 12px 14px; }
  .stat .k { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #a8a29e; }
  .stat .v { font-size: 20px; font-weight: 700; margin-top: 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #78716c; margin: 0 0 12px; }
  select { font: inherit; padding: 9px 10px; border: 1px solid #d6d3d1; border-radius: 9px; background: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #a8a29e; padding: 6px 8px; border-bottom: 1px solid #e7e5e4; }
  td { padding: 8px; border-bottom: 1px solid #f5f5f4; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
  .tag.online { background: #dcfce7; color: #166534; }
  .tag.offline { background: #fee2e2; color: #991b1b; }
  .tag.fault { background: #fef3c7; color: #92400e; }
  .muted { color: #a8a29e; }
  code { background: #f5f5f4; padding: 1px 6px; border-radius: 5px; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>&#9889; Smart-Meter Simulator</h1>
  <p class="sub">Streaming bidirectional readings to <code>{{ ingest_url }}</code></p>

  <div class="card">
    <div class="row" style="justify-content: space-between;">
      <span id="pill" class="pill off"><span class="dot"></span><span id="pillText">Stopped</span></span>
      <div class="row">
        <button id="btnStart" class="start" onclick="post('/start')">&#9654; Start</button>
        <button id="btnStop" class="stop" onclick="post('/stop')">&#9632; Stop</button>
        <button class="ghost" onclick="post('/tick')">Push one tick</button>
      </div>
    </div>
    <div class="stats" style="margin-top:18px;">
      <div class="stat"><div class="k">Meters</div><div class="v" id="mCount">–</div></div>
      <div class="stat"><div class="k">Sim clock</div><div class="v" id="mClock" style="font-size:15px;">–</div></div>
      <div class="stat"><div class="k">Acceleration</div><div class="v" id="mAccel">–</div></div>
      <div class="stat"><div class="k">Interval</div><div class="v" id="mInterval">–</div></div>
    </div>
  </div>

  <div class="card">
    <h2>Fault injection (fraud demo)</h2>
    <div class="row">
      <select id="fMeter"></select>
      <select id="fType">
        <option value="inflate">inflate &rarr; over-capacity (R-03)</option>
        <option value="night">night generation (R-05)</option>
        <option value="offline_report">offline-but-reporting (R-04)</option>
      </select>
      <button class="ghost" onclick="applyFault()">Arm fault</button>
      <button class="ghost" onclick="clearFault()">Clear</button>
    </div>
    <p class="sub" style="margin:12px 0 0;">Alerts show on the Regulator &rarr; Fraud Dashboard within a couple of ticks.</p>
  </div>

  <div class="card">
    <h2>Meters</h2>
    <table>
      <thead><tr><th>Code</th><th>Feeder</th><th>Capacity</th><th>Status</th><th>Fault</th></tr></thead>
      <tbody id="mBody"></tbody>
    </table>
  </div>
</div>

<script>
async function post(path) {
  try { await fetch(path, { method: 'POST' }); } catch (e) {}
  refresh();
}
async function applyFault() {
  const meterCode = document.getElementById('fMeter').value;
  const fault = document.getElementById('fType').value;
  await fetch('/fault', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ meterCode, fault }) });
  refresh();
}
async function clearFault() {
  const meterCode = document.getElementById('fMeter').value;
  await fetch('/fault', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ meterCode, fault: 'clear' }) });
  refresh();
}
async function refresh() {
  let s;
  try { s = await (await fetch('/state')).json(); } catch (e) { return; }
  const running = s.running;
  const pill = document.getElementById('pill');
  pill.className = 'pill ' + (running ? 'on' : 'off');
  pill.querySelector('.dot').className = 'dot' + (running ? ' pulse' : '');
  document.getElementById('pillText').textContent = running ? 'Running — streaming' : 'Stopped';
  document.getElementById('btnStart').disabled = running;
  document.getElementById('btnStop').disabled = !running;
  document.getElementById('mCount').textContent = s.meters.length;
  document.getElementById('mClock').textContent = new Date(s.simTime).toLocaleString();
  document.getElementById('mAccel').textContent = s.acceleration + ' min/tick';
  document.getElementById('mInterval').textContent = s.intervalMinutes + ' min';

  const sel = document.getElementById('fMeter');
  if (sel.options.length !== s.meters.length) {
    sel.innerHTML = s.meters.map(m => `<option value="${m.code}">${m.code}</option>`).join('');
  }
  document.getElementById('mBody').innerHTML = s.meters.map(m => `
    <tr>
      <td><code>${m.code}</code></td>
      <td class="muted">${m.feeder}</td>
      <td>${m.capacityKw} kW</td>
      <td><span class="tag ${m.status}">${m.status}</span></td>
      <td>${m.fault ? `<span class="tag fault">${m.fault}</span>` : '<span class="muted">—</span>'}</td>
    </tr>`).join('');
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>"""


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


@app.get("/")
def control_panel():
    return render_template_string(CONTROL_HTML, ingest_url=config.INGEST_URL)


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
