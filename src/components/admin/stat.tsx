import { Link } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";

const tones = {
  neutral: "before:bg-border-strong",
  primary: "before:bg-primary",
  success: "before:bg-success",
  warning: "before:bg-warning",
  danger: "before:bg-danger",
} as const;

/** A labelled figure. With `href`, the whole card links to the list behind the number. */
export function Stat({ label, value, hint, tone = "neutral", href }: { label: string; value: string; hint?: string; tone?: keyof typeof tones; href?: string }) {
  // dt/dd stay direct children of the card (valid <dl>); a link, when given,
  // sits inside <dt> and stretches over the whole card.
  const body = (
    <>
      <dt className="text-sm text-muted">{href ? <Link href={href} className="after:absolute after:inset-0 hover:text-text">{label}</Link> : label}</dt>
      <dd className="ltr-nums mt-1 font-display text-2xl font-semibold">{value}</dd>
      {hint ? <dd className="mt-1 text-xs text-muted">{hint}</dd> : null}
    </>
  );
  const cls = cn(
    "relative block overflow-hidden rounded-xl border border-border bg-surface p-4 ps-5 shadow-[var(--rn-shadow)] before:absolute before:inset-y-3 before:start-0 before:w-1 before:rounded-full",
    tones[tone],
  );
  return <div className={cn(cls, href && "transition-colors hover:border-primary/50")}>{body}</div>;
}
