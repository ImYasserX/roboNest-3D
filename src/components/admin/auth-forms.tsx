"use client";

import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { adminLoginAction, adminVerifyAction, beginTotpAction, changeAdminPasswordAction, confirmTotpAction } from "@/server/actions/admin/auth";
import { TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

export function AdminLoginForm() {
  const t = useTranslations("admin.login");
  const { state, pending: formPending, formProps } = useActionForm(adminLoginAction, null);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4">
      {state?.error ? <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid_credentials")}</Alert> : null}
      <TextField id="username" name="username" label={t("username")} autoComplete="username" required dir="ltr" maxLength={32} autoCapitalize="none" />
      <TextField id="password" name="password" type="password" label={t("password")} autoComplete="current-password" required maxLength={128} />
      <SubmitButton size="lg" className="w-full">{t("submit")}</SubmitButton>
    </form></FormPendingContext.Provider>
  );
}

export function AdminVerifyForm() {
  const t = useTranslations("admin.login");
  const { state, pending: formPending, formProps } = useActionForm(adminVerifyAction, null);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4">
      {state?.error ? <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid_code")}</Alert> : null}
      <TextField id="code" name="code" label={t("code")} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required dir="ltr" className="ltr-nums text-center text-2xl tracking-[0.4em]" />
      <SubmitButton size="lg" className="w-full">{t("verify")}</SubmitButton>
    </form></FormPendingContext.Provider>
  );
}

export function TotpSetup() {
  const t = useTranslations("admin.security");
  const tc = useTranslations("admin.common");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { state, pending: formPending, formProps } = useActionForm(confirmTotpAction, null);
  if (!setup) {
    return (
      <div className="space-y-3">
        {err ? <Alert tone="danger">{err}</Alert> : null}
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await beginTotpAction();
              if (res.ok) setSetup({ secret: res.secret, qrSvg: res.qrSvg });
              else setErr(tc("error"));
            })
          }
        >
          {t("setup")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">{t("scan")}</p>
      {/* SVG generated server-side by the qrcode library from our own otpauth URI. */}
      <div className="w-fit rounded-lg border border-border bg-white p-2" role="img" aria-label={t("qrLabel")} dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
      <p className="text-sm">
        {t("manual")} <code className="ltr-nums select-all rounded bg-surface-2 px-2 py-1 font-mono text-sm" dir="ltr">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
      </p>
      <FormPendingContext.Provider value={formPending}><form {...formProps} className="flex flex-wrap items-end gap-3">
        {state?.error ? <Alert tone="danger" className="w-full">{t(`errors.${state.error}` as "errors.invalid_code")}</Alert> : null}
        <TextField id="totp-code" name="code" label={t("codeLabel")} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required dir="ltr" wrapperClassName="w-40" />
        <SubmitButton>{t("confirm")}</SubmitButton>
      </form></FormPendingContext.Provider>
    </div>
  );
}

export function AdminPasswordForm() {
  const t = useTranslations("admin.security");
  const { state, pending: formPending, formProps } = useActionForm(changeAdminPasswordAction, null);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="max-w-md space-y-4">
      {state?.success ? <Alert tone="success">{t("changed")}</Alert> : null}
      {state?.error ? <Alert tone="danger">{t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}</Alert> : null}
      <TextField id="current" name="current" type="password" label={t("current")} autoComplete="current-password" required />
      <TextField id="next" name="next" type="password" label={t("new")} hint={t("newHint")} autoComplete="new-password" minLength={12} required />
      <SubmitButton>{t("passwordTitle")}</SubmitButton>
    </form></FormPendingContext.Provider>
  );
}
