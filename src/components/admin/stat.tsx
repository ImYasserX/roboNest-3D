export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="ltr-nums mt-1 text-2xl font-semibold">{value}</dd>
      {hint ? <dd className="mt-1 text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
