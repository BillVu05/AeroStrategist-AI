interface RiskMatrixPanelProps {
  destination: string;
  fuelPriceUsdPerGallon: number;
  gdpGrowthPct: number;
  loadFactor: number;
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

export default function RiskMatrixPanel({
  destination,
  fuelPriceUsdPerGallon,
  gdpGrowthPct,
  loadFactor,
}: RiskMatrixPanelProps) {
  // Fuel: $1/gal = low risk, $6/gal = high risk.
  const fuelRiskPct = clampPct(((fuelPriceUsdPerGallon - 1) / 5) * 100);
  // GDP growth: 0% = stagnant, 10%+ = strong tailwind.
  const gdpPct = clampPct((gdpGrowthPct / 10) * 100);
  const loadPct = clampPct(loadFactor * 100);

  // Geopolitical stability: higher GDP growth → more stable markets
  const geoPct = clampPct(Math.max(0, 100 - gdpGrowthPct * 8 - 20));
  // Weather disruption proxy: seasonal variance based on load factor volatility
  const weatherPct = clampPct(30 + (1 - loadFactor) * 40);

  const gauges = [
    {
      label: "Fuel price exposure",
      value: `$${fuelPriceUsdPerGallon.toFixed(2)}/gal`,
      pct: fuelRiskPct,
      color: fuelRiskPct > 60 ? "bg-error" : fuelRiskPct > 35 ? "bg-secondary" : "bg-tertiary",
      valueColor: fuelRiskPct > 60 ? "text-error" : "text-tertiary",
    },
    {
      label: "GDP growth tailwind",
      value: `${gdpGrowthPct.toFixed(1)}%`,
      pct: gdpPct,
      color: "bg-tertiary",
      valueColor: "text-tertiary",
    },
    {
      label: "Capacity utilization",
      value: `${loadPct.toFixed(0)}%`,
      pct: loadPct,
      color: loadPct > 90 ? "bg-error" : loadPct > 75 ? "bg-secondary" : "bg-tertiary",
      valueColor: loadPct > 90 ? "text-error" : "text-tertiary",
    },
    {
      label: "Geopolitical stability",
      value: `${(100 - geoPct).toFixed(0)}%`,
      pct: 100 - geoPct,
      color: geoPct > 60 ? "bg-error" : geoPct > 35 ? "bg-secondary" : "bg-tertiary",
      valueColor: geoPct > 60 ? "text-error" : geoPct > 35 ? "text-secondary" : "text-tertiary",
    },
    {
      label: "Weather disruption",
      value: `${weatherPct.toFixed(0)}%`,
      pct: weatherPct,
      color: weatherPct > 60 ? "bg-error" : weatherPct > 35 ? "bg-secondary" : "bg-tertiary",
      valueColor: weatherPct > 60 ? "text-error" : weatherPct > 35 ? "text-secondary" : "text-tertiary",
    },
  ];

  const overallFlag = fuelRiskPct > 60 || loadPct > 90 ? "warning" : "shield";

  return (
    <div className="glass-panel flex h-full flex-col rounded-lg">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <h4 className="font-label text-[10px] uppercase tracking-widest text-primary">Risk Matrix · {destination}</h4>
        <span className={`material-symbols-outlined text-[20px] ${overallFlag === "warning" ? "text-error" : "text-tertiary"}`}>
          {overallFlag}
        </span>
      </div>
      <div className="flex-1 space-y-5 p-4">
        {gauges.map((g) => (
          <div key={g.label} className="space-y-1">
            <div className="flex justify-between font-label text-[10px] uppercase tracking-widest">
              <span className="text-on-surface-variant">{g.label}</span>
              <span className={g.valueColor}>{g.value}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full ${g.color}`} style={{ width: `${g.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
