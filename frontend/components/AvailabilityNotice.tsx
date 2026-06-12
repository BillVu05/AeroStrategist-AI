export default function AvailabilityNotice({ text }: { text: string }) {
  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 whitespace-pre-wrap">
      {text}
    </div>
  );
}
