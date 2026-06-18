"use client";

import { useEffect, useRef, useState } from "react";
import { getSearchAirports } from "@/lib/api";
import type { AirportSearchResult, OpenRouteFormValue } from "@/lib/types";
import { AIRCRAFT_TYPES } from "@/lib/constants";

interface OpenRouteFormProps {
  value: OpenRouteFormValue;
  onChange: (value: OpenRouteFormValue) => void;
  comparisonList: string[];
  onAddToComparison: () => void;
  onRemoveFromComparison: (iata: string) => void;
  onAnalyze: () => void;
  onCompare: () => void;
  loading: boolean;
}

const FIELD_CLASS =
  "mt-1 w-full bg-black/20 border-0 border-b border-white/10 focus:border-tertiary focus:ring-0 outline-none px-2 py-2 text-on-surface transition-colors";

const DEBOUNCE_MS = 300;

export default function OpenRouteForm({
  value,
  onChange,
  comparisonList,
  onAddToComparison,
  onRemoveFromComparison,
  onAnalyze,
  onCompare,
  loading,
}: OpenRouteFormProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AirportSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function set<K extends keyof OpenRouteFormValue>(key: K, val: OpenRouteFormValue[K]) {
    onChange({ ...value, [key]: val });
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) return;
    debounceRef.current = setTimeout(() => {
      getSearchAirports(query, 6)
        .then((res) => setSuggestions(res.results))
        .catch(() => setSuggestions([]));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function selectAirport(a: AirportSearchResult) {
    set("destination", a.iata);
    setQuery(`${a.city} (${a.iata})`);
    setShowSuggestions(false);
  }

  const canSubmit = value.destination.trim().length > 0;

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="relative text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Destination
          </span>
          <input
            type="text"
            className={FIELD_CLASS}
            placeholder="City or IATA code, e.g. Bangkok or BKK"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
              if (!e.target.value.trim()) set("destination", "");
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          />
          {showSuggestions && query.trim() && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded border border-white/10 bg-surface-container shadow-lg">
              {suggestions.map((a) => (
                <li key={a.iata}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-on-surface hover:bg-white/10"
                    onClick={() => selectAirport(a)}
                  >
                    <span>
                      {a.city}, {a.country}{" "}
                      <span className="text-on-surface-variant/60">({a.iata})</span>
                    </span>
                    <span className="font-label text-[9px] text-on-surface-variant/50">
                      {a.distance_from_syd_km.toLocaleString()} km
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Weekly frequency
          </span>
          <input
            type="number"
            min={1}
            step="1"
            className={FIELD_CLASS}
            value={value.weekly_frequency}
            onChange={(e) => set("weekly_frequency", Number(e.target.value))}
          />
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Aircraft type
          </span>
          <select
            className={FIELD_CLASS}
            value={value.aircraft_type ?? ""}
            onChange={(e) => set("aircraft_type", e.target.value || undefined)}
          >
            <option value="" className="bg-surface-container text-on-surface">
              Auto (by range)
            </option>
            {AIRCRAFT_TYPES.map((a) => (
              <option key={a} value={a} className="bg-surface-container text-on-surface">
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Avg fare (USD)
          </span>
          <input
            type="number"
            step="1"
            placeholder="Auto (by distance)"
            className={FIELD_CLASS}
            value={value.avg_fare_usd ?? ""}
            onChange={(e) => set("avg_fare_usd", e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Fuel price (USD/gallon)
          </span>
          <input
            type="number"
            step="0.01"
            placeholder="Default ($2.40)"
            className={FIELD_CLASS}
            value={value.fuel_price_usd_per_gallon ?? ""}
            onChange={(e) =>
              set("fuel_price_usd_per_gallon", e.target.value === "" ? undefined : Number(e.target.value))
            }
          />
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Existing carriers
          </span>
          <input
            type="number"
            min={0}
            step="1"
            placeholder="Auto (by market)"
            className={FIELD_CLASS}
            value={value.n_existing_carriers ?? ""}
            onChange={(e) =>
              set("n_existing_carriers", e.target.value === "" ? undefined : Number(e.target.value))
            }
          />
        </label>
      </div>

      {comparisonList.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Comparing:
          </span>
          {comparisonList.map((d) => (
            <span
              key={d}
              className="flex items-center gap-1 rounded-full border border-tertiary/20 bg-tertiary/10 px-3 py-1 text-xs text-tertiary"
            >
              {d}
              <button
                type="button"
                onClick={() => onRemoveFromComparison(d)}
                className="material-symbols-outlined text-[14px] hover:text-error"
              >
                close
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canSubmit || loading}
          className="rounded bg-accent-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Analyzing…" : `Analyze SYD → ${value.destination || "?"}`}
        </button>
        <button
          type="button"
          onClick={onAddToComparison}
          disabled={!canSubmit}
          className="rounded border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          + Add to comparison
        </button>
        {comparisonList.length >= 2 && (
          <button
            type="button"
            onClick={onCompare}
            disabled={loading}
            className="rounded bg-tertiary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-tertiary/80 disabled:opacity-50"
          >
            {loading ? "Comparing…" : `Compare ${comparisonList.length} destinations`}
          </button>
        )}
      </div>
    </div>
  );
}
