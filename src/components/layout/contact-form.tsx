"use client";

import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";

import { useTranslations } from "next-intl";
import { contactAction } from "@/server/actions/contact";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export function ContactForm({ formToken }: { formToken: string }) {
  const t = useTranslations("contact");
  const tc = useTranslations("common");
  const { state, pending: formPending, formProps } = useActionForm(contactAction, null);
  if (state?.ok) return <Alert tone="success">{t("sent")}</Alert>;
  const bad = (f: string) => state?.fields?.includes(f);
  const formError =
    state?.error === "rate_limited" ? tc("rateLimited") : state?.error === "delivery_failed" ? t("errors.delivery_failed") : state?.error === "too_fast" ? t("errors.too_fast") : state?.error ? t("errors.invalid") : null;
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <input type="hidden" name="ts" value={formToken} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="c-name" name="name" label={t("name")} required autoComplete="name" maxLength={80} error={bad("name") ? t("errors.name") : undefined} />
        <TextField id="c-email" name="email" label={t("emailField")} required type="email" dir="ltr" autoComplete="email" maxLength={120} error={bad("email") ? t("errors.email") : undefined} />
      </div>
      <TextField id="c-subject" name="subject" label={t("subject")} required maxLength={120} error={bad("subject") ? t("errors.subject") : undefined} />
      <TextAreaField id="c-message" name="message" label={t("message")} hint={t("messageHint")} required rows={6} minLength={10} maxLength={3000} error={bad("message") ? t("errors.message") : undefined} />
      <div aria-hidden="true" className="hidden">
        <label htmlFor="c-website">Website</label>
        <input id="c-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <SubmitButton size="lg" pendingLabel={t("sending")}>
        {t("send")}
      </SubmitButton>
    </form></FormPendingContext.Provider>
  );
}
