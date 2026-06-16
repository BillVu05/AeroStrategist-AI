export default function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-error/30 bg-error-container/20 px-4 py-3 text-sm text-error">
      {message}
    </div>
  );
}
