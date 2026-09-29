import { cn } from "./cn";
import { AlertIcon, CheckIcon, InfoIcon } from "./icons";

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  primary: "bg-primary-soft text-primary-text border-primary/40",
  success: "bg-success-soft text-success border-success/40",
  warning: "bg-warning-soft text-warning border-warning/40",
  danger: "bg-danger-soft text-danger border-danger/40",
  info: "bg-info-soft text-info border-info/40",
};

/** Status chip. Always carries text, never colour alone (WCAG 1.4.1). */
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children, className, role }: { tone?: "info" | "success" | "warning" | "danger"; title?: string; children?: React.ReactNode; className?: string; role?: "alert" | "status" }) {
  const Icon = tone === "success" ? CheckIcon : tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div role={role ?? (tone === "danger" ? "alert" : "status")} className={cn("flex gap-3 rounded-lg border p-4 text-sm", toneClass[tone], className)}>
      <Icon className="mt-0.5 shrink-0" />
      <div className="space-y-1 text-text">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-text/90">{children}</div> : null}
      </div>
    </div>
  );
}

export function Card({ className, as: As = "div", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "aside" }) {
  return <As className={cn("rounded-xl border border-border bg-surface", className)} {...props} />;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      {icon ? <div className="text-primary-text">{icon}</div> : null}
      <p className="font-display text-lg font-semibold">{title}</p>
      {description ? <p className="max-w-md text-muted">{description}</p> : null}
      {action}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description ? <p className="max-w-2xl text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
