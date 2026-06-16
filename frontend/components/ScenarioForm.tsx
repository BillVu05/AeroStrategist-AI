"use client";

import { ALL_DESTINATIONS, AIRCRAFT_TYPES, MONTH_NAMES } from "@/lib/constants";
import type { ScenarioInput, WhatIfPresets } from "@/lib/types";

interface ScenarioFormProps {
  value: ScenarioInput;
  onChange: (value: ScenarioInput) => void;
  presets: WhatIfPresets;
  onSubmit: () => void;
  loading: boolean;
  submitLabel: string;
}

const FIELD_CLASS =
  "mt-1 w-full bg-black/20 border-0 border-b border-white/10 focus:border-tertiary focus:ring-0 outline-none px-2 py-2 text-on-surface transition-colors";

export default function ScenarioForm({
  value,
  onChange,
  presets,
  onSubmit,
  loading,
  submitLabel,
}: ScenarioFormProps) {
  const presetActive = !!value.preset;

  function set<K extends keyof ScenarioInput>(key: K, val: ScenarioInput[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <form
      className="glass-panel rounded-lg p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Destination
          </span>
          <select
            className={FIELD_CLASS}
            value={value.destination}
            onChange={(e) => set("destination", e.target.value)}
          >
            {ALL_DESTINATIONS.map((d) => (
              <option key={d} value={d} className="bg-surface-container text-on-surface">
                {d}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Year
          </span>
          <input
            type="number"
            className={FIELD_CLASS}
            value={value.year}
            onChange={(e) => set("year", Number(e.target.value))}
          />
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Month
          </span>
          <select
            className={FIELD_CLASS}
            value={value.month}
            onChange={(e) => set("month", Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1} className="bg-surface-container text-on-surface">
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm sm:col-span-2 lg:col-span-3">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Preset scenario
          </span>
          <select
            className={FIELD_CLASS}
            value={value.preset ?? ""}
            onChange={(e) => {
              const preset = e.target.value || undefined;
              onChange({
                ...value,
                preset,
                price_delta_pct: undefined,
                frequency_delta: undefined,
                fuel_price_usd_per_gallon: undefined,
                aircraft_type: undefined,
                rating_delta: undefined,
              });
            }}
          >
            <option value="" className="bg-surface-container text-on-surface">
              None (manual deltas below)
            </option>
            {Object.entries(presets).map(([key, preset]) => (
              <option key={key} value={key} className="bg-surface-container text-on-surface">
                {preset.label}
              </option>
            ))}
          </select>
          {value.preset && presets[value.preset] && (
            <p className="mt-1 text-xs text-on-surface-variant">{presets[value.preset].description}</p>
          )}
        </label>
      </div>

      <fieldset
        className={`mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${
          presetActive ? "opacity-50" : ""
        }`}
        disabled={presetActive}
      >
        <legend className="mb-1 font-label text-[10px] uppercase tracking-widest text-primary">
          Manual deltas {presetActive && "(disabled — preset selected)"}
        </legend>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Price change (%)
          </span>
          <input
            type="number"
            step="1"
            className={FIELD_CLASS}
            value={(value.price_delta_pct ?? 0) * 100}
            onChange={(e) => set("price_delta_pct", Number(e.target.value) / 100)}
          />
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Frequency change (flights/week)
          </span>
          <input
            type="number"
            step="1"
            className={FIELD_CLASS}
            value={value.frequency_delta ?? 0}
            onChange={(e) => set("frequency_delta", Number(e.target.value))}
          />
        </label>

        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Fuel price (USD/gallon)
          </span>
          <input
            type="number"
            step="0.01"
            placeholder="default"
            className={FIELD_CLASS}
            value={value.fuel_price_usd_per_gallon ?? ""}
            onChange={(e) =>
              set("fuel_price_usd_per_gallon", e.target.value === "" ? undefined : Number(e.target.value))
            }
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
              Unchanged
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
            Service rating change
          </span>
          <input
            type="number"
            step="0.1"
            className={FIELD_CLASS}
            value={value.rating_delta ?? 0}
            onChange={(e) => set("rating_delta", Number(e.target.value))}
          />
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={loading}
        className="mt-4 rounded bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Running…" : submitLabel}
      </button>
    </form>
  );
}
