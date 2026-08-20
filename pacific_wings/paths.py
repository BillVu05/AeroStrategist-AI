"""
Where things live on disk.

One definition, imported everywhere. Nineteen modules used to each compute
`Path(__file__).resolve().parents[1]` for themselves, which meant moving a
file changed how it found `data/` - a silent breakage, since a wrong path
surfaces as a missing-file error somewhere unrelated rather than at the line
that guessed wrong.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "models"
DOCS_DIR = ROOT / "docs"

PROCESSED_DIR = DATA_DIR / "processed"
REFERENCE_DIR = DATA_DIR / "reference"
RAW_DIR = DATA_DIR / "raw"

AIRLINE_PROFILE = DATA_DIR / "airline_profile.json"
AIRCRAFT_SPECS = DATA_DIR / "aircraft_specs.json"

DEMAND_OBSERVATIONS = PROCESSED_DIR / "demand_observations.csv"
COMPETITORS = PROCESSED_DIR / "competitors.csv"

AIRPORTS = REFERENCE_DIR / "airports.csv"
MACRO_INDICATORS = REFERENCE_DIR / "macro_indicators.csv"
FUEL_PRICES = REFERENCE_DIR / "fuel_prices.csv"

MARKET_MODEL = MODELS_DIR / "market_model.json"
METRICS = MODELS_DIR / "metrics.json"
BOOTSTRAP = MODELS_DIR / "bootstrap.json"

REPORTS = DATA_DIR / "reports.json"
REPORTS_SEED = DATA_DIR / "reports.seed.json"
