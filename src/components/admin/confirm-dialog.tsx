"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/components/ui/cn";

type State = { ok?: boolean; error?: string; message?: string } | null;

/**
 * A button that opens a modal <dialog> holding a server-action form. Used for
 * every consequential admin decision (payment confirmation, bulk deletion…):
 * the dialog states exactly what will happen before anything is sent. The
 * server re-validates everything; the dialog is never the control.
 * Escape and the Cancel button close it; focus returns to the trigger.
 */
export function ConfirmDialog({
  trigger,
  triggerVariant = "secondary",
  triggerSize = "sm",
  title,
  description,
  confirmLabel,
  tone = "primary",
  action,
  errorNamespace,
  successText,
  children,
  onDone,
  disabled,
  testId,
}: {
  trigger: React.ReactNode;
  triggerVariant?: "primary" | "secondary" | "ghost" | "danger";
  triggerSize?: "sm" | "md";
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  action: (prev: State, formData: FormData) => Promise<State>;
  errorNamespace?: string;
  successText?: string;
  children?: React.ReactNode;
  onDone?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const tc = useTranslations("admin.common");
  const tns = useTranslations(errorNamespace ?? "admin.common");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { state, pending, formProps } = useActionForm(action, null);

  useEffect(() => {
    if (state?.ok) {
      ref.current?.close();
      onDone?.();
    }
  }, [state, onDone]);

  const errorText = (code: string) =>
    code === "forbidden" || code === "unauthorized" || code === "conflict" ? tc(code) : errorNamespace && tns.has(`errors.${code}`) ? tns(`errors.${code}`) : tc("error");

  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, triggerSize)} onClick={() => ref.current?.showModal()} disabled={disabled} data-testid={testId}>
        {trigger}
      </button>
      {state?.ok && successText ? (
        <span role="status" className="text-sm font-medium text-success">{successText}</span>
      ) : null}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-border-strong bg-surface p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <FormPendingContext.Provider value={pending}>
          <form {...formProps} className="space-y-4 p-5 sm:p-6">
            <div className="space-y-1">
              <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
              {description ? <div className="text-sm text-muted">{description}</div> : null}
            </div>
            {state?.error ? <Alert tone="danger">{errorText(state.error)}</Alert> : null}
            {children}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <button type="button" className={buttonClass("ghost", "md")} onClick={() => ref.current?.close()}>
                {tc("cancel")}
              </button>
              <SubmitButton variant={tone === "danger" ? "danger" : "primary"} className={cn(tone === "danger" && "font-semibold")}>
                {confirmLabel}
              </SubmitButton>
            </div>
          </form>
        </FormPendingContext.Provider>
      </dialog>
    </>
  );
}
