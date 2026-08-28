// The five agents, in pipeline order, defined once.
//
// This lived in three places - AGENT_META here, AGENT_DEFINITIONS in
// constants.ts, an AGENTS array in the copilot page, and a fourth copy inside
// RouteAnalysisCard - which is how the dashboard came to call the same agent
// "Demand Gen" while the report library called it "Demand Agent".

export interface AgentMeta {
  icon: string;
  label: string;
  /** One line on what it contributes, shown in the pipeline panels. */
  blurb: string;
  /** LLM-backed agents need GEMINI_API_KEY; the other two always run. */
  llm: boolean;
}

export const AGENT_META: Record<string, AgentMeta> = {
  demand: {
    icon: "trending_up",
    label: "Demand Agent",
    blurb: "Passenger & load factor forecasts",
    llm: false,
  },
  finance: {
    icon: "monitoring",
    label: "Finance Agent",
    blurb: "Revenue, cost & profit modelling",
    llm: false,
  },
  market: {
    icon: "travel_explore",
    label: "Market Agent",
    blurb: "Competitor landscape & tourism trends",
    llm: true,
  },
  risk: {
    icon: "shield",
    label: "Risk Agent",
    blurb: "Fuel, competitive & macro risk flags",
    llm: true,
  },
  strategy: {
    icon: "psychology",
    label: "Strategy Agent",
    blurb: "Boardroom-ready recommendations",
    llm: true,
  },
};

/** [id, meta] pairs in pipeline order, for rendering the agent lists. */
export const AGENT_LIST = Object.entries(AGENT_META).map(([id, meta]) => ({ id, ...meta }));
