"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { auditLegacyPreviewAction } from "@/server/actions/admin/products";
import { SubmitButton } from "@/components/ui/submit-button";

/** Runs the proxy checks on the legacy GLB and reports; it never publishes it. */
export function LegacyPreviewAudit({ productId }: { productId: string }) {
  const t = useTranslations("admin.products.preview");
  const [state, action] = useActionState(auditLegacyPreviewAction, null);
  const r = state?.result;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <SubmitButton variant="secondary" size="sm">{t("legacyAudit")}</SubmitButton>
      <p aria-live="polite" className="text-sm">
        {!r ? null : r.state === "none" ? t("legacyNone") : r.state === "missing" ? t("legacyMissing") : r.inspection.ok ? t("legacyPasses", { triangles: r.inspection.triangles }) : t("legacyFails", { reasons: r.inspection.reasons.join(", ") })}
      </p>
    </form>
  );
}
