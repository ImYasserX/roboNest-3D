"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CubeIcon } from "@/components/ui/icons";

/**
 * Interactive GLB preview via <model-viewer>. The ~1 MB viewer and the model
 * are only downloaded after the visitor asks for them.
 */
export function ModelPreview({ src, name, sizeLabel }: { src: string; name: string; sizeLabel?: string }) {
  const t = useTranslations("product");
  const tc = useTranslations("common");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  async function load() {
    setState("loading");
    try {
      await import("@google/model-viewer");
      setState("ready");
    } catch {
      setState("error");
    }
  }

  if (state !== "ready") {
    return (
      <div className="bg-blueprint flex aspect-square flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface-2 p-6 text-center">
        <CubeIcon size={48} className="text-primary-text" />
        <Button onClick={load} disabled={state === "loading"} aria-busy={state === "loading"}>
          {state === "loading" ? tc("loading") : t("load3d")}
        </Button>
        {sizeLabel ? <p className="text-xs text-muted">{t("load3dNote", { size: sizeLabel })}</p> : null}
        {state === "error" ? <p className="text-sm text-danger">{t("errors.not_found")}</p> : null}
      </div>
    );
  }
  return (
    <figure className="space-y-2">
      <div className="aspect-square overflow-hidden rounded-xl border border-border bg-surface-2">
      <model-viewer
        src={src}
        alt={t("preview3dLabel", { name })}
        camera-controls=""
        auto-rotate=""
        shadow-intensity="1"
        exposure="1.1"
        interaction-prompt="none"
        camera-orbit="-35deg 65deg auto"
        style={{ display: "block", width: "100%", height: "100%", background: "var(--rn-surface-2)" }}
      />
      </div>
      <figcaption className="text-xs text-muted">{t("view3dHint")}</figcaption>
    </figure>
  );
}
