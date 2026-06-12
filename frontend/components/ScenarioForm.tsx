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
      className="rounded border border-gray-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="block text-gray-500">Destination</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={value.destination}
            onChange={(e) => set("destination", e.target.value)}
          >
            {ALL_DESTINATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-gray-500">Year</span>
          <input
            type="number"
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={value.year}
            onChange={(e) => set("year", Number(e.target.value))}
          />
        </label>

        <label className="text-sm">
          <span className="block text-gray-500">Month</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={value.month}
            onChange={(e) => set("month", Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm sm:col-span-2 lg:col-span-3">
          <span className="block text-gray-500">Preset scenario</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 p-2"
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
            <option value="">None (manual deltas below)</option>
            {Object.entries(presets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
          {value.preset && presets[value.preset] && (
            <p className="mt-1 text-xs text-gray-500">{presets[value.preset].description}</p>
          )}
        </label>
      </div>

      <fieldset
        className={`mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${
          presetActive ? "opacity-50" : ""
        }`}
        disabled={presetActive}
      >
        <legend className="mb-1 text-sm font-medium text-gray-700">
          Manual deltas {presetActive && "(disabled — preset selected)"}
        </legend>

        <label className="text-sm">
          <span className="block text-gray-500">Price change (%)</span>
          <input
            type="number"
            step="1"
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={(value.price_delta_pct ?? 0) * 100}
            onChange={(e) => set("price_delta_pct", Number(e.target.value) / 100)}
          />
        </label>

        <label className="text-sm">
          <span className="block text-gray-500">Frequency change (flights/week)</span>
          <input
            type="number"
            step="1"
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={value.frequency_delta ?? 0}
            onChange={(e) => set("frequency_delta", Number(e.target.value))}
          />
        </label>

        <label className="text-sm">
          <span className="block text-gray-500">Fuel price (USD/gallon)</span>
          <input
            type="number"
            step="0.01"
            placeholder="default"
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={value.fuel_price_usd_per_gallon ?? ""}
            onChange={(e) =>
              set("fuel_price_usd_per_gallon", e.target.value === "" ? undefined : Number(e.target.value))
            }
          />
        </label>

        <label className="text-sm">
          <span className="block text-gray-500">Aircraft type</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={value.aircraft_type ?? ""}
            onChange={(e) => set("aircraft_type", e.target.value || undefined)}
          >
            <option value="">Unchanged</option>
            {AIRCRAFT_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-gray-500">Service rating change</span>
          <input
            type="number"
            step="0.1"
            className="mt-1 w-full rounded border border-gray-300 p-2"
            value={value.rating_delta ?? 0}
            onChange={(e) => set("rating_delta", Number(e.target.value))}
          />
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={loading}
        className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Running…" : submitLabel}
      </button>
    </form>
  );
}
