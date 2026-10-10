"use client";

import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";

import { useTranslations } from "next-intl";
import {
  cancelVerificationAction,
  changePasswordAction,
  forgotPasswordAction,
  loginAction,
  registerAction,
  resendCodeAction,
  resetPasswordAction,
  resetWithCodeAction,
  updateProfileAction,
  verifyPhoneAction,
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

/** SMS code entry for registration, first sign-in of an unverified number, or password recovery. */
export function VerifyCodeForm({ next, maskedPhone, channel = "SMS", smsFallback = false }: { next?: string; maskedPhone: string; channel?: "SMS" | "WHATSAPP"; smsFallback?: boolean }) {
  const t = useTranslations("auth");
  const err = useErrorText();
  const { state, pending, formProps } = useActionForm(verifyPhoneAction, null);
  const resend = useActionForm(resendCodeAction, null);
  if (state?.error === "already_registered") {
    return (
      <Alert tone="info" title={t("alreadyRegisteredTitle")}>
        <p>{t("alreadyRegisteredText")}</p>
        <p className="mt-2 flex flex-wrap gap-3">
          <Link href="/login" className="font-semibold underline">{t("signIn")}</Link>
          <Link href="/forgot-password" className="font-semibold underline">{t("forgot")}</Link>
        </p>
      </Alert>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-muted">{channel === "WHATSAPP" ? t("codeSentToWhatsapp") : t("codeSentTo")} <bdi className="ltr-nums font-semibold text-text">{maskedPhone}</bdi></p>
      <FormPendingContext.Provider value={pending}>
        <form {...formProps} className="space-y-4" noValidate>
          {state?.error ? <Alert tone="danger">{err(state.error)}</Alert> : null}
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <TextField id="code" name="code" label={t("code")} hint={t("codeHint")} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} dir="ltr" />
          <SubmitButton size="lg" className="w-full" pendingLabel={t("verifying")}>{t("verify")}</SubmitButton>
        </form>
      </FormPendingContext.Provider>
      <FormPendingContext.Provider value={resend.pending}>
        <form {...resend.formProps} className="space-y-2">
          {resend.state?.success ? <Alert tone="success">{t("codeResent")}</Alert> : null}
          {resend.state?.error ? <Alert tone="danger">{err(resend.state.error)}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="ghost" size="sm">{t("resend")}</SubmitButton>
            {smsFallback ? (
              <SubmitButton variant="ghost" size="sm" name="channel" value="SMS">{t("sendBySms")}</SubmitButton>
            ) : null}
          </div>
        </form>
      </FormPendingContext.Provider>
      <form action={cancelVerificationAction}>
        <SubmitButton variant="ghost" size="sm">{t("startOver")}</SubmitButton>
      </form>
    </div>
  );
}

export function ForgotPhoneForm() {
  const t = useTranslations("auth");
  const err = useErrorText();
  const { state, pending, formProps } = useActionForm(forgotPasswordAction, null);
  return (
    <FormPendingContext.Provider value={pending}>
      <form {...formProps} className="space-y-4" noValidate>
        {state?.error ? <Alert tone="danger">{err(state.error)}</Alert> : null}
        <TextField id="phone" name="phone" type="tel" inputMode="tel" dir="ltr" autoComplete="tel" label={t("phone")} required maxLength={24} />
        <SubmitButton size="lg" className="w-full" pendingLabel={t("sendingCode")}>{t("sendCode")}</SubmitButton>
      </form>
    </FormPendingContext.Provider>
  );
}

export function NewPasswordWithCodeForm() {
  const t = useTranslations("auth");
  const err = useErrorText();
  const { state, pending, formProps } = useActionForm(resetWithCodeAction, null);
  if (state?.success) {
    return (
      <Alert tone="success" title={t("resetDone")}>
        <Link href="/login" className="font-semibold underline">{t("signIn")}</Link>
      </Alert>
    );
  }
  return (
    <FormPendingContext.Provider value={pending}>
      <form {...formProps} className="space-y-4" noValidate>
        {state?.error ? <Alert tone="danger">{state.error === "password_too_short" ? t("errors.password_too_short") : err(state.error)}</Alert> : null}
        <TextField id="password" name="password" type="password" autoComplete="new-password" label={t("newPassword")} hint={t("passwordHint")} required minLength={8} maxLength={128} />
        <SubmitButton size="lg" className="w-full">{t("resetSubmit")}</SubmitButton>
      </form>
    </FormPendingContext.Provider>
  );
}
