"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";

// Shown for unexpected server/client errors. Never renders the error message
// or stack: production errors only expose an opaque digest for support.
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error(error.digest ?? "client error");
  }, [error]);
  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center gap-5 py-16 text-center">
      <h1 className="font-display text-3xl font-bold">{t("errorTitle")}</h1>
      <p className="max-w-md text-muted">{t("errorText")}</p>
      {error.digest ? <p className="ltr-nums text-xs text-muted">{t("reference", { digest: error.digest })}</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>{t("tryAgain")}</Button>
        <ButtonLink href="/" variant="outline">{t("goHome")}</ButtonLink>
      </div>
    </Container>
  );
}
