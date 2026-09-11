# Smart-Meter Simulator (Flask)

Emulates bidirectional smart meters across the Gandhinagar feeders defined in
[`../data/gandhinagar.json`](../data/gandhinagar.json) and pushes readings to
the Next.js ingestion endpoint. Substitutes for physical hardware (DC-6) — the
`/api/ingest/readings` contract (§7.3) is identical to what a real meter emits.

## Setup

```bash
cd simulator
python -m venv .venv
# Windows: .venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # set SIM_SERVICE_TOKEN to match the Next.js .env
python app.py               # control API on http://localhost:5001
```

Seed MongoDB first (`npm run seed` in the project root) so the meter codes the
simulator emits already exist.

## Control API

| Method | Route | Purpose |
|---|---|---|
| POST | `/start` | Begin the auto-push loop |
| POST | `/stop` | Pause pushing |
| POST | `/tick` | Push one batch now (manual step) |
| POST | `/fault` | Arm/clear a fault on a meter |
| GET | `/state` | Sim clock, running flag, per-meter fault state |
| GET | `/health` | Liveness |

## Fault injection (Appendix B)

```bash
# Inflate generation beyond capacity → expect R-03 / over_claim
curl -X POST localhost:5001/fault -H "Content-Type: application/json" \
  -d '{"meterCode":"GNR-M-00001","fault":"inflate"}'

# Night-time generation → expect R-05
curl -X POST localhost:5001/fault -d '{"meterCode":"GNR-M-00002","fault":"night"}'

# Reporting while offline → expect R-04
curl -X POST localhost:5001/fault -d '{"meterCode":"GNR-M-00003","fault":"offline_report"}'

# Clear a fault
curl -X POST localhost:5001/fault -d '{"meterCode":"GNR-M-00001","fault":"clear"}'

# Then push a batch and watch alerts appear in the regulator dashboard:
curl -X POST localhost:5001/tick
```

## Time acceleration (SM-5)

`SIM_ACCELERATION` sim-minutes advance per tick; `SIM_TICK_SECONDS` real seconds
between ticks. Defaults (96 / 2s) run a full simulated day in ~30 seconds — long
enough to show a midday export surplus and an evening deficit.
