import type {
  AnalyzeRouteResponse,
  ChatMessage,
  ChatResponse,
  CompareRoutesResponse,
  CopilotResponse,
  DemandForecastResponse,
  FutureAnalysisResponse,
  HealthResponse,
  MacroProjectionResponse,
  MarketContext,
  MonteCarloResponse,
  NetworkFutureAnalysisResponse,
  RouteEconomicsResponse,
  RoutesResponse,
  ScenarioInput,
  SearchAirportsResponse,
  WhatIfPresets,
  WhatIfResponse,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

async function getJSON<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status} for ${path}: ${body}`);
  }
  return res.json();
}

export function getHealth() {
  return getJSON<HealthResponse>("/health");
}

export function getMarketContext(destination: string, year: number = 2024) {
  return getJSON<MarketContext>("/market_context", { destination, year });
}

export function getDemandForecast(params: {
  destination: string;
  year: number;
  month: number;
  avg_fare_usd?: number;
  origin?: string;
}) {
  return getJSON<DemandForecastResponse>("/demand_forecast", params);
}

export function getRouteEconomics(params: {
  destination: string;
  year: number;
  month: number;
  avg_fare_usd?: number;
  fuel_price_usd_per_gallon?: number;
  origin?: string;
}) {
  return getJSON<RouteEconomicsResponse>("/route_economics", params);
}

export function getWhatIfPresets() {
  return getJSON<WhatIfPresets>("/what_if_presets");
}

export function getWhatIf(params: ScenarioInput) {
  return getJSON<WhatIfResponse>("/what_if", params);
}

export function getAnalyzeRoute(params: {
  destination: string;
  weekly_frequency?: number;
  aircraft_type?: string;
  avg_fare_usd?: number;
  fuel_price_usd_per_gallon?: number;
  n_existing_carriers?: number;
}) {
  return getJSON<AnalyzeRouteResponse>("/analyze_route", params);
}

export function getAnalyzeRouteAgents(params: {
  destination: string;
  weekly_frequency?: number;
  aircraft_type?: string;
  avg_fare_usd?: number;
  fuel_price_usd_per_gallon?: number;
  n_existing_carriers?: number;
}) {
  return getJSON<AnalyzeRouteResponse>("/analyze_route_agents", params);
}

export function getCompareRoutes(params: {
  destinations: string[];
  weekly_frequency?: number;
  fuel_price_usd_per_gallon?: number;
}) {
  return getJSON<CompareRoutesResponse>("/compare_routes", {
    ...params,
    destinations: params.destinations.join(","),
  });
}

export function getSearchAirports(query: string, limit: number = 8) {
  return getJSON<SearchAirportsResponse>("/search_airports", { query, limit });
}

export function getMonteCarlo(params: {
  destination: string;
  year: number;
  month: number;
  n_simulations?: number;
  price_delta_pct?: number;
  frequency_delta?: number;
  aircraft_type?: string;
  rating_delta?: number;
}) {
  return getJSON<MonteCarloResponse>("/monte_carlo", params);
}

export function getRoutes() {
  return getJSON<RoutesResponse>("/routes");
}

export function getCopilot(params: ScenarioInput) {
  return getJSON<CopilotResponse>("/copilot", params);
}

export function getMacroProjection(destination: string, fromYear: number = 2024, toYear: number = 2032) {
  return getJSON<MacroProjectionResponse>("/macro_projection", {
    destination,
    from_year: fromYear,
    to_year: toYear,
  });
}

export function getFutureAnalysis(
  destination: string,
  fromYear: number = 2024,
  toYear: number = 2032,
  scenario?: { price_delta_pct?: number; frequency_delta?: number; aircraft_type?: string; rating_delta?: number }
) {
  return getJSON<FutureAnalysisResponse>("/future_analysis", {
    destination,
    from_year: fromYear,
    to_year: toYear,
    ...scenario,
  });
}

export function getNetworkFutureAnalysis(fromYear: number = 2025, toYear: number = 2032) {
  return getJSON<NetworkFutureAnalysisResponse>("/network_future_analysis", {
    from_year: fromYear,
    to_year: toYear,
  });
}

export async function postChat(messages: ChatMessage[]) {
  const res = await fetch(new URL("/chat", BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status} for /chat: ${body}`);
  }
  return res.json() as Promise<ChatResponse>;
}
