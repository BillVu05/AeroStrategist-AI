export const ACTIVE_DESTINATIONS = ["SIN", "HND", "MEL", "AKL"] as const;
export const ALL_DESTINATIONS = ["SIN", "HND", "MEL", "AKL", "DAD"] as const;
export const AIRCRAFT_TYPES = ["A320-200", "A321neo", "B787-9"] as const;

// Current year/month — the app forecasts forward from "now". Future-year
// demand is handled server-side via the macro growth multiplier.
const NOW = new Date();
export const DEFAULT_YEAR: number = NOW.getFullYear();
export const DEFAULT_MONTH: number = NOW.getMonth() + 1;

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

