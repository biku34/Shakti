"""Simulator configuration (SM-8). Values come from env with sane defaults."""
import os
from dotenv import load_dotenv

load_dotenv()

# Where to POST readings (the Next.js ingestion endpoint, §7.3).
INGEST_URL = os.getenv("INGEST_URL", "http://localhost:3000/api/ingest/readings")
# Must match SIM_SERVICE_TOKEN in the Next.js .env (SEC-4, CI-3).
SIM_SERVICE_TOKEN = os.getenv("SIM_SERVICE_TOKEN", "change-me-simulator-token")

# Simulation clock.
INTERVAL_MINUTES = int(os.getenv("SIM_INTERVAL_MINUTES", "15"))   # meter reporting interval
TICK_SECONDS = float(os.getenv("SIM_TICK_SECONDS", "2"))          # real seconds between ticks
ACCELERATION = float(os.getenv("SIM_ACCELERATION", "96"))         # sim-minutes advanced per tick

# Shared topology manifest (same file the Next.js seed reads).
MANIFEST_PATH = os.getenv(
    "SIM_MANIFEST",
    os.path.join(os.path.dirname(__file__), "..", "data", "gandhinagar.json"),
)

# Flask control API.
HOST = os.getenv("SIM_HOST", "0.0.0.0")
PORT = int(os.getenv("SIM_PORT", "5001"))
