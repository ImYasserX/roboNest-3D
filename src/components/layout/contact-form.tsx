"use client";

import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";

import { useTranslations } from "next-intl";
import { contactAction } from "@/server/actions/contact";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export function ContactForm() {
  const t = useTranslations("contact");
  const tc = useTranslations("common");
  const tco = useTranslations("checkout");
  const { state, pending: formPending, formProps } = useActionForm(contactAction, null);
  if (state?.ok) return <Alert tone="success">{t("sent")}</Alert>;
  const bad = (f: string) => state?.fields?.includes(f);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4" noValidate>
      {state?.error ? <Alert tone="danger">{state.error === "rate_limited" ? tc("rateLimited") : t("errors.invalid")}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="c-name" name="name" label={t("name")} required autoComplete="name" maxLength={80} error={bad("name") ? t("errors.invalid") : undefined} />
        <TextField id="c-phone" name="phone" label={t("phone")} required type="tel" dir="ltr" autoComplete="tel" maxLength={24} error={bad("phone") ? tco("errors.invalid_phone") : undefined} />
      </div>
      <TextField id="c-subject" name="subject" label={t("subject")} required maxLength={120} error={bad("subject") ? t("errors.invalid") : undefined} />
      <TextAreaField id="c-message" name="message" label={t("message")} required rows={6} maxLength={3000} error={bad("message") ? t("errors.invalid") : undefined} />
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
