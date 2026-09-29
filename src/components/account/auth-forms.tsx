"use client";

import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";

import { useTranslations } from "next-intl";
import {
  changePasswordAction,
  loginAction,
  registerAction,
  resetPasswordAction,
  updateProfileAction,

} from "@/server/actions/auth";
import { SelectField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";
import { Link } from "@/i18n/navigation";

function useErrorText() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const ta = useTranslations("account");
  return (code?: string) => {
    if (!code) return undefined;
    if (code === "rate_limited") return tc("rateLimited");
    if (code === "unauthorized") return tc("sessionExpired");
    if (code === "wrong_password") return ta("errors.wrong_password");
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : tc("unknownError");
  };
}

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const err = useErrorText();
  const { state, pending: formPending, formProps } = useActionForm(loginAction, null);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4" noValidate>
      {state?.error ? <Alert tone="danger">{err(state.error)}</Alert> : null}
      <input type="hidden" name="next" value={next} />
      <TextField id="phone" name="phone" type="tel" inputMode="tel" dir="ltr" autoComplete="tel" label={t("phone")} required defaultValue={state?.values?.phone} maxLength={24} />
      <TextField id="password" name="password" type="password" autoComplete="current-password" label={t("password")} required maxLength={128} />
      <SubmitButton size="lg" className="w-full" pendingLabel={t("signingIn")}>
        {t("signIn")}
      </SubmitButton>
      <p className="text-sm">
        <Link href="/forgot-password" className="text-primary-text underline">
          {t("forgot")}
        </Link>
      </p>
    </form></FormPendingContext.Provider>
  );
}

export function RegisterForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const err = useErrorText();
  const { state, pending: formPending, formProps } = useActionForm(registerAction, null);
  const f = state?.fields ?? {};
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4" noValidate>
      {state?.error && Object.keys(f).length === 0 ? <Alert tone="danger">{err(state.error)}</Alert> : null}
      <input type="hidden" name="next" value={next} />
      <TextField id="name" name="name" autoComplete="name" label={t("name")} required defaultValue={state?.values?.name} error={err(f.name)} maxLength={80} />
      <TextField id="phone" name="phone" type="tel" inputMode="tel" dir="ltr" autoComplete="tel" label={t("phone")} required defaultValue={state?.values?.phone} error={err(f.phone)} maxLength={24} />
      <TextField id="password" name="password" type="password" autoComplete="new-password" label={t("password")} hint={t("passwordHint")} required minLength={8} maxLength={128} error={err(f.password)} />
      <SubmitButton size="lg" className="w-full" pendingLabel={t("registering")}>
        {t("register")}
      </SubmitButton>
    </form></FormPendingContext.Provider>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const err = useErrorText();
  const { state, pending: formPending, formProps } = useActionForm(resetPasswordAction, null);
  if (state?.success) {
    return (
      <Alert tone="success" title={t("resetDone")}>
        <Link href="/login" className="font-semibold underline">
          {t("signIn")}
        </Link>
      </Alert>
    );
  }
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4" noValidate>
      {state?.error ? <Alert tone="danger">{err(state.error)}</Alert> : null}
      <input type="hidden" name="token" value={token} />
      <TextField id="password" name="password" type="password" autoComplete="new-password" label={t("password")} hint={t("passwordHint")} required minLength={8} maxLength={128} />
      <SubmitButton size="lg" className="w-full">
        {t("resetSubmit")}
      </SubmitButton>
    </form></FormPendingContext.Provider>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations("account");
  const err = useErrorText();
  const { state, pending: formPending, formProps } = useActionForm(changePasswordAction, null);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4" noValidate>
      {state?.success ? <Alert tone="success">{t("passwordChanged")}</Alert> : null}
      {state?.error ? <Alert tone="danger">{state.error === "password_too_short" ? t("errors.password_too_short") : err(state.error)}</Alert> : null}
      <TextField id="current" name="current" type="password" autoComplete="current-password" label={t("currentPassword")} required maxLength={128} />
      <TextField id="next" name="next" type="password" autoComplete="new-password" label={t("newPassword")} hint={t("passwordHint")} required minLength={8} maxLength={128} />
      <SubmitButton>{t("changePassword")}</SubmitButton>
    </form></FormPendingContext.Provider>
  );
}

export function ProfileForm({ name, locale }: { name: string; locale: string }) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const err = useErrorText();
  const { state, pending: formPending, formProps } = useActionForm(updateProfileAction, null);
  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-4" noValidate>
      {state?.success ? <Alert tone="success">{t("profileSaved")}</Alert> : null}
      {state?.error ? <Alert tone="danger">{err(state.error)}</Alert> : null}
      <TextField id="profile-name" name="name" autoComplete="name" label={t("name")} required defaultValue={name} maxLength={80} />
      <SelectField id="profile-locale" name="locale" label={t("language")} defaultValue={locale}>
        <option value="ar">العربية</option>
        <option value="en">English</option>
      </SelectField>
      <SubmitButton>{tc("save")}</SubmitButton>
    </form></FormPendingContext.Provider>
  );
}
