// Shared between the Report Library cards and the save-to-library calls in
// /reports/new and /open-route - keeps the agent key -> icon/label mapping
// in one place instead of three.

export const AGENT_META: Record<string, { icon: string; label: string }> = {
  demand: { icon: "trending_up", label: "Demand Agent" },
  finance: { icon: "monitoring", label: "Finance Agent" },
  market: { icon: "travel_explore", label: "Market Agent" },
  risk: { icon: "shield", label: "Risk Agent" },
  strategy: { icon: "psychology", label: "Strategy Agent" },
};
