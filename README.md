# Renewable Energy Intelligence Platform

A **P2P energy-trading marketplace** and a **REC (Renewable Energy Certificate) fraud-detection system** on a single stack, unified by one design decision: **metered rooftop-solar generation is the only source of truth.**

A single verified export event drives *both* the tradable surplus *and* the basis for REC issuance. Energy therefore **cannot be double-sold**, and RECs **cannot be over-claimed** — the two systems reconcile against the same metered kWh instead of two independent ledgers that can drift apart.

## Why it's hard (and how we solve it)

| Problem | Approach |
|---|---|
| Double-selling surplus energy | One export event is consumed by trading *and* REC issuance; settlement decrements the same balance. |
| RECs claimed against energy that was never produced | Certificate issuance is bound to metered, ingested readings — not self-reported figures. |
| Tampered or back-dated certificates | Every trade, issuance, transfer, and retirement is **hash-anchored on-chain**; provenance is verifiable against the chain. |
| Fraud at scale | **Layered detection**: deterministic rules → statistical anomaly detection → agentic LLM review, in increasing cost/depth. |

## Architecture

| Layer | Tech |
|---|---|
| App (UI + API) | **Next.js 15** (App Router, TypeScript, server actions/route handlers) |
| Persistence | **MongoDB Atlas** (Mongoose) |
| Trust layer | **Polygon Amoy** via **Alchemy** + **viem** — content-hash anchoring, **server-side only** (no browser web3, no keys in the client) |
| Meter data | **In-process smart-meter simulator** — bidirectional, per-meter control panel at `/smart` |
| Intelligence | **Rule engine** (dynamic pricing + fraud rules R-01–R-08) + **statistical anomaly detector** (R-09, robust modified z-score per-meter baseline) + optional **Groq** agentic fraud review + optional **Gemini** feeder-congestion recommendations |

### Layered fraud detection

1. **Rule engine (R-01–R-08)** — deterministic checks (impossible ramps, generation without irradiance window, duplicate exports, over-issuance vs. metered kWh, etc.). Fast, explainable, always on.
2. **Statistical detector (R-09)** — robust *modified z-score* against each meter's own rolling baseline, so it catches meter-specific anomalies without a global threshold.
3. **Agentic review (Groq)** — batch review for the regulator and a per-REC evidence check on un-anchored certificates. Optional; the system is fully functional without it.

### Trust layer

`liveSubmit()` in `src/services/blockchain/adapter.ts` computes a canonical SHA-256 of the record and submits it as calldata to Polygon Amoy via viem, waiting for the receipt. `BLOCKCHAIN_MOCK=true` records deterministic mock tx hashes so the entire flow runs offline with **zero testnet funds** — the anchoring code path is identical either way.

## Project layout

```
src/
  app/api/               all backend route handlers
  lib/                   env, db, auth/RBAC, roles, api helpers
  models/                Mongoose models (one per collection)
  services/
    trading/             pricing.ts (dynamic pricing) · matching.ts (order-book settlement)
    rec/                 recService.ts (certificate lifecycle)
    fraud/               detector.ts (rules R-01..R-08) · statistical.ts (R-09 z-score) · groqDetector.ts (agentic review)
    ai/                  recommendations.ts (Gemini congestion actions + deterministic fallback)
    blockchain/          adapter.ts (anchor/verify) · hash.ts (canonical sha256)
    simulator/           engine.ts (in-process bidirectional smart-meter simulator)
    ingest/              ingestReadings.ts (shared reading-ingestion core)
    audit.ts             append-only audit log
data/gandhinagar.json    shared demo topology (seed + simulator both read this)
scripts/seed.ts          populate MongoDB from the manifest
```

## Quick start

```bash
npm install
cp .env.example .env      # set MONGODB_URI, AUTH_SECRET, SIM_SERVICE_TOKEN
npm run seed             # 3 feeders, prosumers + consumers, one of each oversight role
npm run dev              # http://localhost:3000
```

Demo login password: `password123`. Runs fully offline by default (`BLOCKCHAIN_MOCK=true`).

**Optional keys:**
- `ALCHEMY_API_KEY` + funded `ANCHOR_PRIVATE_KEY` with `BLOCKCHAIN_MOCK=false` → real Polygon Amoy anchoring.
- `GROQ_API_KEY` (or `GROQ_API_KEYS` pool) → agentic fraud review.
- `GEMINI_API_KEYS` + `GEMINI_MODEL` → AI feeder-congestion recommendations (deterministic severity ranking as fallback, so the panel always renders).

## Simulator

Runs inside the Next.js server — no separate process. Open **`/smart`**, **Start** any meter to stream readings (only that meter's owner sees live updates), *Push one tick* for a manual batch, and arm faults to trigger fraud anomalies on demand.

Control API (same-origin): `GET /api/smart/state`, `POST /api/smart/meter {meterCode, running}`, `POST /api/smart/tick`, `POST /api/smart/fault {meterCode, fault}`.

## API surface

| Group | Routes |
|---|---|
| Auth | `POST /api/auth/{register,login,logout}` · `GET /api/me` |
| Ingestion | `POST /api/ingest/readings` (service token) |
| Trading | `GET /api/feeders/:id/{orderbook,price}` · `POST/DELETE /api/offers[/:id]` · `POST/DELETE /api/bids[/:id]` · `GET /api/trades/mine` |
| REC | `POST /api/rec/request` · `GET /api/rec/issuance-queue` · `POST /api/rec/:id/{approve,transfer,retire,revoke}` · `GET /api/rec/:id/provenance` · `POST /api/rec/:id/ai-review` |
| REC market | `GET /api/rec/market` · `POST /api/rec/:id/{list,unlist,buy}` (credits move buyer→seller, ownership transfers, anchored) |
| Fraud | `GET /api/fraud/alerts` · `POST /api/fraud/alerts/:id/status` · `POST /api/fraud/{scan,ai-scan}` |
| Oversight | `GET /api/utility/feeders` · `POST /api/utility/recommendations` · `GET /api/reports/market` · `GET /api/audit/export` · `GET /api/verify/:refType/:refId` |

## End-to-end demo flow

1. `npm run seed && npm run dev`, start a meter at `/smart` → readings stream, feeder load/congestion update live.
2. Prosumer lists midday surplus (`POST /api/offers`).
3. Consumer bids (`POST /api/bids`) → matching settles trades in credits, **each anchored on Polygon**.
4. Prosumer requests a REC → certificate body approves from the queue → **REC issued + anchored**.
5. Arm a fault at `/smart` → fraud rules raise alerts.
6. Regulator triages and revokes the REC → auditor verifies provenance against the chain.

## What's built

**Functional end-to-end:** auth/RBAC, ingestion + validation, dynamic pricing, order book, matching & settlement, full REC lifecycle, fraud rules R-01–R-08, the R-09 statistical anomaly detector, Groq agentic review (batch + per-REC), Gemini congestion recommendations with deterministic fallback, **live Polygon Amoy anchoring** (viem + Alchemy) with mock fallback, all six role dashboards, append-only audit log, and oversight reports.

**Next up:** SSE/live widgets in place of interval refresh, and asynchronous anchor confirmation (currently waits for the receipt inline).
