// TypeScript types mirroring the FastAPI response shapes in api/main.py.

export interface DemandForecastResponse {
  origin: string;
  destination: string;
  year: number;
  month: number;
  avg_fare_usd: number;
  predicted_passengers: number;
  capacity_monthly: number;
  predicted_load_factor: number;
}

export interface RevenueBreakdown {
  destination: string;
  total_passengers: number;
  avg_fare_usd: number;
  cabin_breakdown: Record<string, { passengers: number; fare_usd: number; revenue_usd: number }>;
  ticket_revenue_usd: number;
  ancillary_revenue_usd: number;
  total_revenue_usd: number;
}

export interface CostBreakdown {
  destination: string;
  aircraft_type: string;
  weekly_frequency: number;
  fuel_price_usd_per_gallon: number;
  ask_month: number;
  fuel_cost_usd: number;
  non_fuel_cost_usd: number;
  non_fuel_cost_breakdown_usd: Record<string, number>;
  total_cost_usd: number;
  total_casm_usd: number;
}

export interface RouteEconomicsResponse {
  origin: string;
  destination: string;
  year: number;
  month: number;
  demand: {
    predicted_passengers: number;
    capacity_monthly: number;
    predicted_load_factor: number;
  };
  revenue: RevenueBreakdown;
  cost: CostBreakdown;
  profit_usd: number;
}

export interface WhatIfPreset {
  label: string;
  description: string;
}

export type WhatIfPresets = Record<string, WhatIfPreset>;

export interface ScenarioParams {
  avg_fare_usd: number;
  weekly_frequency: number;
  aircraft_type: string;
  fuel_price_usd_per_gallon: number;
  pacific_wings_rating: number;
  tourism_arrivals_multiplier: number;
  extra_competitors: { name: string; price: number; weekly_frequency: number; rating: number }[];
}

export interface ScenarioDemand {
  predicted_demand_passengers: number;
  capacity_monthly: number;
  passengers_carried: number;
  load_factor: number;
  demand_constrained_by_capacity: boolean;
}

export interface MarketShare {
  pacific_wings_share: number;
  shares_by_carrier: Record<string, number>;
}

export interface ScenarioResult {
  origin: string;
  destination: string;
  year: number;
  month: number;
  scenario: ScenarioParams;
  demand: ScenarioDemand;
  revenue: RevenueBreakdown;
  cost: CostBreakdown;
  profit_usd: number;
  market_share: MarketShare;
}

export interface WhatIfResponse {
  baseline: ScenarioResult;
  scenario: ScenarioResult;
  delta: {
    profit_usd: number;
    passengers_carried: number;
    pacific_wings_share: number;
  };
  preset?: { name: string; label: string; description: string };
}

// /routes
export interface RouteMarket {
  gdp_usd: number;
  gdp_growth_pct: number;
  population: number;
  tourism_arrivals: number;
  snapshot_year: number;
}

export interface RouteInfo {
  destination: string;
  destination_name: string;
  destination_city: string;
  destination_country: string;
  lat: number;
  lon: number;
  distance_km: number;
  status: "active" | "candidate";
  weekly_frequency: number;
  assigned_aircraft: string;
  flight_duration_hours: number;
  market: RouteMarket;
}

export interface AirportInfo {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export interface RoutesResponse {
  origin: AirportInfo;
  routes: RouteInfo[];
}

// /chat
export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface ChatResponse {
  available: boolean;
  reply: string;
  tool_calls: ChatToolCall[];
}

// /market_context
export interface Competitor {
  name: string;
  weekly_frequency: number;
  avg_fare_usd: number;
  rating: number;
}

export interface MarketContext {
  origin: string;
  destination: string;
  destination_city: string;
  destination_country: string;
  distance_km: number;
  flight_duration_hours: number;
  current_weekly_frequency: number;
  assigned_aircraft: string;
  macro_year: number;
  gdp_usd: number;
  gdp_growth_pct: number;
  population: number;
  tourism_arrivals_baseline: number;
  tourism_arrivals_snapshot_year: number;
  competitors: Competitor[];
}

// /copilot
export interface CopilotFinanceRow {
  revenue_usd: number;
  cost_usd: number;
  profit_usd: number;
}

export interface CopilotResponse {
  origin: string;
  destination: string;
  year: number;
  month: number;
  scenario: ScenarioParams;
  demand: {
    baseline: ScenarioDemand;
    scenario: ScenarioDemand;
    delta: { passengers_carried: number; load_factor: number };
    demand_constrained_by_capacity: boolean;
  };
  finance: {
    baseline: CopilotFinanceRow;
    scenario: CopilotFinanceRow;
    delta: { profit_usd: number; revenue_usd: number; cost_usd: number };
  };
  market_analysis: { available: boolean; commentary: string; context: MarketContext };
  risk_analysis: { available: boolean; risks: string };
  strategy: { available: boolean; executive_summary: string };
}

// /health
export interface HealthResponse {
  status: string;
  llm_available: boolean;
}

// Shared form state for the Scenario Simulator.
export interface ScenarioInput {
  destination: string;
  year: number;
  month: number;
  price_delta_pct?: number;
  frequency_delta?: number;
  fuel_price_usd_per_gallon?: number;
  aircraft_type?: string;
  rating_delta?: number;
  preset?: string;
  [key: string]: unknown;
}
