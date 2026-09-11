# Renewable Energy Intelligence Platform

Integrated **P2P Energy Trading Marketplace** + **REC Fraud Detection System** on one
stack. Metered rooftop-solar generation is the shared source of truth (§3.3): a single
verified export event drives both the tradable surplus and the basis for REC issuance and
fraud checks — so energy can't be double-sold and RECs can't be over-claimed.

Built to the [SRS v1.0](#) — see requirement tags (FR-x, BC-x, SEC-x) in the code comments.

## Stack

| Layer | Tech |
|---|---|
| App (UI + API) | **Next.js 15** (App Router, TypeScript) |
| Persistence | **MongoDB Atlas** (Mongoose) |
| Trust layer | **Polygon Amoy** via **Alchemy** — anchoring only, **server-side** (no browser web3, DC-2) |
| Meter data | **In-process Node simulator** (control panel at `/smart`) emitting the §7.3 ingestion contract |
| Intelligence | **Rule engine** (pricing §9.1, detection §9.2) behind swappable interfaces → Groq later |

## Project layout

```
src/
  app/                 Next.js routes
    api/               all backend API routes (§11)
    page.tsx           landing page (role dashboards are stubs)
  lib/                 env, db, auth/RBAC, api helpers, roles
  models/              Mongoose models — one per §5 collection
  services/
    trading/           pricing.ts (§9.1), matching.ts (§6.5)
    rec/               recService.ts (§6.6 lifecycle)
    fraud/             detector.ts (§9.2 rules R-01..R-08)
    blockchain/        adapter.ts (§8 anchor/verify), hash.ts (canonical sha256)
    audit.ts           append-only audit log
    services/
    simulator/         engine.ts — in-process bidirectional smart-meter simulator
    ingest/            ingestReadings.ts — shared reading-ingestion core
data/gandhinagar.json  shared demo topology (seed + simulator read this)
scripts/seed.ts        populate MongoDB from the manifest
```

## Setup

### 1. Install & configure

```bash
npm install
cp .env.example .env      # fill MONGODB_URI, AUTH_SECRET, SIM_SERVICE_TOKEN
```

Defaults run fully offline: `BLOCKCHAIN_MOCK=true` records deterministic mock tx
hashes (no Alchemy account or testnet funds needed). Set it to `false` and provide
`ALCHEMY_API_KEY` + `ANCHOR_PRIVATE_KEY` to anchor for real (integration point marked
in `src/services/blockchain/adapter.ts`).

### 2. Seed the demo data

```bash
npm run seed
```

Creates 3 Gandhinagar feeders with prosumers (+bidirectional meters) and consumers,
plus one regulator / certificate body / auditor / utility. Demo password: `password123`.

### 3. Run the app

```bash
npm run dev            # http://localhost:3000
```

### 4. Run the simulator

The simulator now runs inside the Next.js server — no separate process. Open the
control panel at **http://localhost:3000/smart** and **Start** any meter to stream
readings for that meter only (its owner's dashboard updates live). Each meter has
its own Start/Stop; use *Push one tick* for a single manual batch and the fault
panel (Appendix B) to arm fraud anomalies.

Control API (same-origin): `GET /api/smart/state`, `POST /api/smart/meter`
`{meterCode, running}` (or `{all, running}`), `POST /api/smart/tick`,
`POST /api/smart/fault` `{meterCode, fault}`.

## API surface (§11)

| Group | Routes |
|---|---|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/me` |
| Ingestion | `POST /api/ingest/readings` (service token) |
| Trading | `GET /api/feeders/:id/orderbook` · `GET /api/feeders/:id/price` · `POST/DELETE /api/offers[/:id]` · `POST/DELETE /api/bids[/:id]` · `GET /api/trades/mine` |
| REC | `POST /api/rec/request` · `GET /api/rec/issuance-queue` · `POST /api/rec/:id/{approve,transfer,retire,revoke}` · `GET /api/rec/:id/provenance` |
| Fraud | `GET /api/fraud/alerts` · `POST /api/fraud/alerts/:id/status` · `POST /api/fraud/scan` |
| Oversight | `GET /api/utility/feeders` · `GET /api/reports/market` · `GET /api/audit/export` · `GET /api/verify/:refType/:refId` |

## Demo flow (Appendix C)

1. `npm run seed`, `npm run dev`, start a meter at `/smart` → readings stream in, feeder load/congestion update.
2. Log in as a prosumer → `POST /api/offers` to list midday surplus.
3. Log in as a consumer → `POST /api/bids`; matching settles trades in credits, each anchored on Polygon.
4. Prosumer `POST /api/rec/request` → certificate body approves from the issuance queue → REC issued + anchored.
5. Arm a fault from `/smart` (Appendix B) → fraud rules raise alerts.
6. Regulator triages the alert and revokes the REC; auditor verifies provenance against the chain.

## What's scaffolded vs. stubbed

**Wired & functional:** auth/RBAC, ingestion + validation, dynamic pricing, order book,
matching & settlement, REC lifecycle, fraud rules R-01..R-08, mock/real anchoring, audit
log, oversight reports, the simulator.

**Stubbed for you to build:** the role dashboard UIs (landing page is a placeholder), live
polling/SSE widgets (NFR-P2), and the live Alchemy signing path.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
