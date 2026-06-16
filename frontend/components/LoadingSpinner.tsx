export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-on-surface-variant">
      <span className="w-2 h-2 rounded-full bg-tertiary agent-pulse" />
      Loading…
    </div>
  );
}
