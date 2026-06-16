import type {
  ChatMessage,
  ChatResponse,
  CopilotResponse,
  DemandForecastResponse,
  HealthResponse,
  MarketContext,
  RouteEconomicsResponse,
  RoutesResponse,
  ScenarioInput,
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

export function getRoutes() {
  return getJSON<RoutesResponse>("/routes");
}

export function getCopilot(params: ScenarioInput) {
  return getJSON<CopilotResponse>("/copilot", params);
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
