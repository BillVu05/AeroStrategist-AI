export const ACTIVE_DESTINATIONS = ["SIN", "HND", "MEL", "AKL"] as const;
export const ALL_DESTINATIONS = ["SIN", "HND", "MEL", "AKL", "DAD"] as const;
export const AIRCRAFT_TYPES = ["A320-200", "A321neo", "B787-9"] as const;

export const DEFAULT_YEAR: number = 2024;
export const DEFAULT_MONTH: number = 6;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const EXAMPLE_QUESTIONS = [
  "Forecast demand for Da Nang from 2024 to 2027",
  "Which routes will be most profitable in 2026?",
  "Should we launch Sydney to Da Nang?",
  "What happens if fuel prices rise 25%?",
  "What will Singapore revenue look like in 2026?",
  "Which route has the fastest demand growth trajectory?",
  "Project GDP and tourism for Japan through 2032",
  "Which routes deliver the highest profit over the next 7 years?",
  "How will Vietnam's market grow through 2030?",
  "Should we open a route to Dubai?",
  "Analyse a new route from Sydney to London",
  "Compare routes to Dubai, Delhi, and Tokyo as new destinations",
  "Is a Sydney to New York route financially viable?",
];

export interface AgentDefinition {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  /** Pure-compute agents are always "ACTIVE"; LLM agents need llm_available. */
  llmBacked: boolean;
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: "market",
    name: "Market Research",
    blurb: "Competitor landscape, GDP & tourism trends",
    icon: "travel_explore",
    llmBacked: true,
  },
  {
    id: "demand",
    name: "Demand Gen",
    blurb: "Passenger demand & load factor forecasts",
    icon: "trending_up",
    llmBacked: false,
  },
  {
    id: "finance",
    name: "Financial Analyst",
    blurb: "Revenue, cost & profit modeling",
    icon: "monitoring",
    llmBacked: false,
  },
  {
    id: "risk",
    name: "Risk Guardian",
    blurb: "Fuel, competitive & macro risk flags",
    icon: "shield",
    llmBacked: true,
  },
  {
    id: "strategy",
    name: "Strategy Gen",
    blurb: "Boardroom-ready route recommendations",
    icon: "psychology",
    llmBacked: true,
  },
];
