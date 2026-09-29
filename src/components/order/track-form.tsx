"use client";

import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";

import { useTranslations } from "next-intl";
import { trackOrderAction } from "@/server/actions/track";
import { TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export function TrackForm() {
  const t = useTranslations("order");
  const tc = useTranslations("common");
  const tco = useTranslations("checkout");
  const { state, pending: formPending, formProps } = useActionForm(trackOrderAction, null);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4">
      {state?.error ? <Alert tone="danger">{state.error === "rate_limited" ? tc("rateLimited") : t("notFound")}</Alert> : null}
      <TextField id="orderNumber" name="orderNumber" label={t("orderNumber")} hint={t("orderNumberHint")} required dir="ltr" autoCapitalize="characters" maxLength={40} />
      <TextField id="phone" name="phone" type="tel" inputMode="tel" label={tco("phone")} required dir="ltr" autoComplete="tel" maxLength={24} />
      <SubmitButton size="lg" className="w-full" pendingLabel={tc("loading")}>
        {t("track")}
      </SubmitButton>
    </form></FormPendingContext.Provider>
  );
}
