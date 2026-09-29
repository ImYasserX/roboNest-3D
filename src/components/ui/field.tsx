import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

// Native controls only: they are accessible, work with autofill, and behave
// correctly in RTL. Every control gets a visible <label>; hints and errors are
// linked with aria-describedby and errors set aria-invalid.

export const controlClass =
  "block w-full rounded-md border border-border-strong bg-surface px-3 py-2.5 text-base text-text placeholder:text-muted/80 aria-[invalid=true]:border-danger disabled:opacity-60";

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optionalLabel?: string;
  className?: string;
  children: (describedBy: string | undefined) => React.ReactNode;
};

export function Field({ id, label, hint, error, required, optionalLabel, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : optionalLabel ? (
          <span className="font-normal text-muted"> ({optionalLabel})</span>
        ) : null}
      </label>
      {children(describedBy)}
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; hint?: string; error?: string; optionalLabel?: string; wrapperClassName?: string };

export function TextField({ id, label, hint, error, optionalLabel, wrapperClassName, className, ...props }: Common & InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={props.required} optionalLabel={optionalLabel} className={wrapperClassName}>
      {(describedBy) => (
        <input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={cn(controlClass, className)} {...props} />
      )}
    </Field>
  );
}

export function TextAreaField({ id, label, hint, error, optionalLabel, wrapperClassName, className, ...props }: Common & TextareaHTMLAttributes<HTMLTextAreaElement> & { id: string }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={props.required} optionalLabel={optionalLabel} className={wrapperClassName}>
      {(describedBy) => (
        <textarea id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={cn(controlClass, "min-h-28", className)} {...props} />
      )}
    </Field>
  );
}

export function SelectField({
  id,
  label,
  hint,
  error,
  optionalLabel,
  wrapperClassName,
  className,
  children,
  ...props
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { id: string }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={props.required} optionalLabel={optionalLabel} className={wrapperClassName}>
      {(describedBy) => (
        <select id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={cn(controlClass, "pe-8", className)} {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function CheckboxField({ id, label, hint, className, ...props }: { id: string; label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input id={id} type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint ? (
          <span id={`${id}-hint`} className="block text-muted">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}
