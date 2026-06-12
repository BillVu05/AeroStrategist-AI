-- Airline Strategy Simulator - core schema (Phase 2)
-- Real reference data: airports, aircraft, macro_indicators, fuel_prices
-- Simulation/derived data: routes, competitors, demand_observations

CREATE TABLE airports (
    iata               CHAR(3) PRIMARY KEY,
    name               TEXT NOT NULL,
    city               TEXT NOT NULL,
    country            CHAR(3) NOT NULL,
    lat                DOUBLE PRECISION NOT NULL,
    lon                DOUBLE PRECISION NOT NULL
);

CREATE TABLE aircraft (
    type                          TEXT PRIMARY KEY,
    manufacturer                  TEXT NOT NULL,
    seats_business                INTEGER NOT NULL DEFAULT 0,
    seats_premium_economy         INTEGER NOT NULL DEFAULT 0,
    seats_economy                 INTEGER NOT NULL DEFAULT 0,
    seats_total                   INTEGER NOT NULL,
    range_km                      INTEGER NOT NULL,
    cruise_fuel_burn_kg_per_hour  INTEGER NOT NULL,
    cruise_speed_kmh              INTEGER NOT NULL,
    casm_usd                      NUMERIC(6, 4) NOT NULL
);

CREATE TABLE routes (
    route_id        SERIAL PRIMARY KEY,
    origin          CHAR(3) NOT NULL REFERENCES airports(iata),
    destination     CHAR(3) NOT NULL REFERENCES airports(iata),
    distance_km     NUMERIC(8, 1) NOT NULL,
    aircraft_type   TEXT NOT NULL REFERENCES aircraft(type),
    weekly_frequency INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active', -- active | candidate
    UNIQUE (origin, destination)
);

-- Real, sourced from World Bank Open Data API
CREATE TABLE macro_indicators (
    country             CHAR(3) NOT NULL,
    year                INTEGER NOT NULL,
    gdp_usd             NUMERIC(20, 2),
    gdp_growth_pct      NUMERIC(6, 3),
    population          BIGINT,
    tourism_arrivals    BIGINT,
    PRIMARY KEY (country, year)
);

-- Real, sourced from EIA jet fuel spot price history
CREATE TABLE fuel_prices (
    price_date      DATE PRIMARY KEY,
    usd_per_gallon  NUMERIC(6, 3) NOT NULL,
    source          TEXT NOT NULL DEFAULT 'EIA'
);

-- Synthetic-but-calibrated: competitor presence per route
CREATE TABLE competitors (
    route_id            INTEGER NOT NULL REFERENCES routes(route_id),
    competitor_name     TEXT NOT NULL,
    weekly_frequency    INTEGER NOT NULL DEFAULT 0,
    avg_fare_usd        NUMERIC(8, 2),
    rating              NUMERIC(3, 2),
    PRIMARY KEY (route_id, competitor_name)
);

-- Synthetic-but-calibrated: monthly demand used as ML training target
CREATE TABLE demand_observations (
    route_id        INTEGER NOT NULL REFERENCES routes(route_id),
    year            INTEGER NOT NULL,
    month           INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    passengers      INTEGER NOT NULL,
    avg_fare_usd    NUMERIC(8, 2),
    load_factor     NUMERIC(5, 4),
    PRIMARY KEY (route_id, year, month)
);
