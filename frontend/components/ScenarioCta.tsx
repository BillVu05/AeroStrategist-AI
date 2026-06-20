import Link from "next/link";

interface ScenarioCtaProps {
  destination: string;
}

export default function ScenarioCta({ destination }: ScenarioCtaProps) {
  return (
    <Link
      href={`/simulator?dest=${destination}`}
      className="glass-panel flex h-full flex-col justify-between rounded-lg border-l-2 border-tertiary p-4 transition-colors hover:bg-white/5"
    >
      <div>
        <h5 className="mb-2 flex items-center justify-between font-label text-[10px] uppercase tracking-widest text-primary">
          Scenario simulator · {destination}
          <span className="material-symbols-outlined text-[16px] text-tertiary">science</span>
        </h5>
        <p className="text-sm text-on-surface-variant">
          Model pricing, frequency, fuel, and fleet changes with full Monte Carlo risk output.
        </p>
      </div>
      <span className="mt-4 flex items-center gap-1 font-label text-[11px] font-medium text-tertiary">
        Open Simulator
        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
      </span>
    </Link>
  );
}
