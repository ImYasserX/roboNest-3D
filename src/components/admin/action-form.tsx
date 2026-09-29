"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";
import { Alert } from "@/components/ui/misc";

type State = { ok?: boolean; error?: string; message?: string } | null;

/**
 * Generic admin form bound to a server action. Shows a success or error
 * banner; error codes are looked up in `errorNamespace` then admin.common.
 */
export function ActionForm({
  action,
  children,
  errorNamespace,
  className,
  successText,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  children: React.ReactNode;
  errorNamespace?: string;
  className?: string;
  successText?: string;
}) {
  const tc = useTranslations("admin.common");
  const tns = useTranslations(errorNamespace ?? "admin.common");
  const { state, pending: formPending, formProps } = useActionForm(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  // After a successful save, fields return to the (refreshed) server values;
  // after an error they keep what the user typed.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  const errorText = (code: string) =>
    code === "forbidden" || code === "unauthorized" || code === "conflict" ? tc(code) : errorNamespace && tns.has(`errors.${code}`) ? tns(`errors.${code}`) : tc("error");
  return (
    <FormPendingContext.Provider value={formPending}>
      <form ref={formRef} {...formProps} className={className ?? "space-y-3"}>
      {state?.ok ? <Alert tone="success"><span className="break-all select-all">{state.message ?? successText ?? tc("saved")}</span></Alert> : null}
      {state?.error ? <Alert tone="danger">{errorText(state.error)}</Alert> : null}
      {children}
    </form></FormPendingContext.Provider>
  );
}
