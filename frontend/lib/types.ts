// TypeScript types mirroring the FastAPI response shapes in api/main.py.

// Real confidence score (ml/confidence.py) - combines bootstrap ensemble
// disagreement, per-route historical reliability, and extrapolation
// distance from the training data into one 0-100 score. Replaces the
// fabricated "Confidence %" badges removed during the realism audit.
export interface ConfidenceBreakdown {
  bootstrap_uncertainty_deduction: number;
  historical_reliability_deduction: number;
  extrapolation_deduction: number;
}

export interface DemandForecastResponse {
  origin: string;
  destination: string;
  year: number;
  month: number;
  avg_fare_usd: number;
  predicted_passengers: number;
  predicted_passengers_low: number;
  predicted_passengers_high: number;
  capacity_monthly: number;
  predicted_load_factor: number;
  predicted_load_factor_low: number;
  predicted_load_factor_high: number;
  confidence_pct: number;
  confidence_breakdown: ConfidenceBreakdown;
  confidence_notes: string[];
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
    confidence_pct: number;
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
  confidence_pct: number;
  confidence_breakdown: ConfidenceBreakdown;
  confidence_notes: string[];
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
  /** 0=low, 1=moderate, 2=elevated, 3=high - real per-country table, see agents/open_route_analyst.py */
  geopolitical_risk: number;
  /** 0=stable, 1=moderate, 2=volatile - real per-country table, see agents/open_route_analyst.py */
  currency_risk: number;
  /** Real XGBoost feature importances from the trained demand model - same across all destinations */
  demand_feature_importances: Record<string, number>;
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

// /macro_projection
export interface MacroProjectionYear {
  gdp_usd: number;
  gdp_growth_pct: number;
  gdp_index: number;
  population: number;
  tourism_arrivals: number;
  tourism_index: number;
  fuel_price_usd_per_gallon: number;
  demand_multiplier: number;
  data_source: "historical" | "projected";
}

export interface MacroProjectionResponse {
  destination: string;
  destination_city: string;
  destination_country: string;
  from_year: number;
  to_year: number;
  yearly: Record<string, MacroProjectionYear>;
}

// /future_analysis
export interface FutureAnalysisMonth {
  month: number;
  passengers: number;
  load_factor: number;
  revenue_usd: number;
  profit_usd: number;
}

export interface FutureAnalysisYear {
  annual_passengers: number;
  annual_revenue_usd: number;
  annual_profit_usd: number;
  avg_load_factor: number;
  peak_month: number;
  yoy_growth_pct: number | null;
  projected_fuel_price_usd_per_gallon: number;
  tourism_arrivals_multiplier: number;
  tourism_arrivals: number;
  gdp_usd: number;
  gdp_growth_pct: number;
  demand_multiplier: number;
  monthly: FutureAnalysisMonth[];
}

export interface FutureAnalysisResponse {
  destination: string;
  destination_city: string;
  destination_country: string;
  from_year: number;
  to_year: number;
  passenger_cagr_pct: number | null;
  yearly: Record<string, FutureAnalysisYear>;
}

// /network_future_analysis
export interface NetworkFutureRoute {
  destination: string;
  destination_city: string;
  destination_country: string;
  status: "active" | "candidate";
  passenger_cagr_pct: number | null;
  demand_multiplier_end_year: number;
  total_projected_passengers: number;
  total_projected_revenue_usd: number;
  total_projected_profit_usd: number;
  start_year_passengers: number;
  end_year_passengers: number;
  start_year_profit_usd: number;
  end_year_profit_usd: number;
  start_year_load_factor: number;
  end_year_load_factor: number;
}

export interface NetworkFutureAnalysisResponse {
  from_year: number;
  to_year: number;
  network_total_projected_profit_usd: number;
  network_total_projected_revenue_usd: number;
  network_total_projected_passengers: number;
  routes: NetworkFutureRoute[];
}

// /monte_carlo
export interface MonteCarloSummary {
  mean: number;
  std: number;
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
}

export interface MonteCarloAssumption {
  distribution: string;
  source: string;
  [key: string]: unknown;
}

export interface MonteCarloResponse {
  destination: string;
  year: number;
  month: number;
  n_simulations: number;
  seed: number;
  assumptions: {
    fuel_price_usd_per_gallon: MonteCarloAssumption;
    gdp_growth_pct: MonteCarloAssumption;
    competitor_entry: MonteCarloAssumption;
  };
  profit_usd: MonteCarloSummary;
  passengers_carried: MonteCarloSummary;
  load_factor: MonteCarloSummary;
  pacific_wings_share: MonteCarloSummary;
  probability_of_loss: number;
  profit_histogram: { bin_edges: number[]; counts: number[] };
}

// /analyze_route, /analyze_route_agents, /compare_routes, /search_airports
export interface OpenRouteInfo {
  origin: string;
  origin_city: string;
  destination: string;
  destination_city: string;
  destination_country: string;
  distance_km: number;
  flight_hours: number;
}

export interface OpenRouteMarket {
  destination_gdp_usd_billions: number;
  destination_population_millions: number;
  destination_tourism_millions_2019: number;
  bilateral_market_estimate_annual_pax: number;
  bilateral_market_low: number;
  bilateral_market_high: number;
  existing_competitors_estimate: number;
  pacific_wings_market_share_estimate: number;
}

export interface OpenRouteOperations {
  aircraft_type: string;
  aircraft_range_km: number;
  aircraft_in_range: boolean;
  range_note: string;
  total_seats: number;
  weekly_frequency: number;
  monthly_capacity_seats: number;
}

export interface OpenRouteDemandEstimate {
  annual_passengers_pacific_wings: number;
  monthly_passengers: number;
  load_factor_estimate: number;
  confidence_low_annual: number;
  confidence_high_annual: number;
  note: string;
}

export interface OpenRouteFinancials {
  avg_fare_usd: number;
  fuel_price_usd_per_gallon: number;
  monthly_revenue_usd: number;
  monthly_cost_usd: number;
  monthly_profit_usd: number;
  annual_revenue_usd: number;
  annual_cost_usd: number;
  annual_profit_usd: number;
  operating_margin_pct: number;
  breakeven_load_factor: number;
  note: string;
}

export interface OpenRouteRisk {
  geopolitical_risk: number;
  currency_risk: number;
  demand_risk: number;
  competition_risk: number;
  financial_risk: number;
  overall_risk_score: number;
  risk_scale: string;
}

export interface OpenRouteScoring {
  demand_score: number;
  financial_score: number;
  strategic_score: number;
  composite_score: number;
  score_scale: string;
}

export interface OpenRouteAgentEvidence {
  demand: {
    bilateral_market_estimate_annual_pax: number;
    pacific_wings_market_share_estimate_pct: number;
    annual_passengers_pacific_wings: number;
    load_factor_estimate: number;
    confidence_range_annual: [number, number];
  };
  finance: {
    annual_revenue_usd: number;
    annual_cost_usd: number;
    annual_profit_usd: number;
    operating_margin_pct: number;
    breakeven_load_factor: number;
  };
  market: { available: boolean; commentary: string };
  risk: { available: boolean; risks: string };
  strategy: { available: boolean; executive_summary: string };
}

export interface AnalyzeRouteResponse {
  route: OpenRouteInfo;
  market: OpenRouteMarket;
  operations: OpenRouteOperations;
  demand_estimate: OpenRouteDemandEstimate;
  financials: OpenRouteFinancials;
  risk: OpenRouteRisk;
  scoring: OpenRouteScoring;
  verdict: string;
  pros: string[];
  cons: string[];
  agent_evidence?: OpenRouteAgentEvidence;
  error?: string;
  suggestions?: AirportSearchResult[];
}

export interface CompareRoutesRankedRoute {
  destination: string;
  city: string;
  country: string;
  distance_km: number;
  aircraft_type: string;
  in_range: boolean;
  annual_passengers: number;
  load_factor: number;
  annual_profit_usd: number;
  operating_margin_pct: number;
  breakeven_lf: number;
  overall_risk: number;
  composite_score: number;
  verdict: string;
  top_pro: string;
  top_con: string;
}

export interface CompareRoutesResponse {
  weekly_frequency: number;
  routes_analysed: number;
  ranked_routes: CompareRoutesRankedRoute[];
  errors: { destination: string; error: string }[];
}

export interface AirportSearchResult {
  iata: string;
  name: string;
  city: string;
  country: string;
  distance_from_syd_km: number;
}

export interface SearchAirportsResponse {
  query: string;
  results: AirportSearchResult[];
}

// /reports - Strategic Report Library persistence
export type ReportKind = "route_analysis" | "open_route";

export interface ReportSummary {
  id: string;
  created_at: string;
  kind: ReportKind;
  title: string;
  description: string;
  destination: string;
  destination_city: string;
  agents: string[];
}

export interface ReportRecord extends ReportSummary {
  payload: CopilotResponse | AnalyzeRouteResponse;
}

export interface ReportsListResponse {
  reports: ReportSummary[];
}

export interface SaveReportRequest {
  kind: ReportKind;
  destination: string;
  destination_city: string;
  title: string;
  description: string;
  agents: string[];
  payload: CopilotResponse | AnalyzeRouteResponse;
  id?: string;
}

// Shared form state for the Open Route page.
export interface OpenRouteFormValue {
  destination: string;
  weekly_frequency: number;
  aircraft_type?: string;
  avg_fare_usd?: number;
  fuel_price_usd_per_gallon?: number;
  n_existing_carriers?: number;
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
