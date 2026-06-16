export default function AvailabilityNotice({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-secondary/30 bg-secondary-container/20 px-4 py-3 text-sm text-secondary whitespace-pre-wrap">
      {text}
    </div>
  );
}
