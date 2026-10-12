"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ModelViewerElement } from "@/types/model-viewer";
import { Button } from "@/components/ui/button";
import { CubeIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";

const START_ORBIT = "-35deg 70deg auto";

/**
 * Interactive 3D preview of an APPROVED preview proxy (a reduced, unit-scaled
 * mesh served by /api/previews/[id]), never of a paid file. The viewer code
 * (~1 MB) and the proxy are only downloaded after the visitor asks for them.
 * On any error the panel says so; there is no fallback to another file.
 */
export function ModelViewer({ src, name, className }: { src: string; name: string; className?: string }) {
  const t = useTranslations("product.viewer");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [spinning, setSpinning] = useState(true);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<ModelViewerElement>(null);
  const hintId = useId();

  async function load() {
    setMounted(false);
    setState("loading");
    setProgress(0);
    try {
      await import("@google/model-viewer");
      // The element reports load / error / progress (listeners below).
      setMounted(true);
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    const el = ref.current;
    if (!el || !mounted) return;
    const onLoad = () => setState("ready");
    const onError = () => setState("error");
    const onProgress = (e: Event) => setProgress(Math.round(((e as CustomEvent<{ totalProgress: number }>).detail?.totalProgress ?? 0) * 100));
    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);
    el.addEventListener("progress", onProgress);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
      el.removeEventListener("progress", onProgress);
    };
  }, [mounted]);

  // Event handlers only: the element is read when a control is pressed.
  function zoom(steps: number) {
    ref.current?.zoom(steps);
  }
  function reset() {
    const el = ref.current;
    if (!el) return;
    el.cameraOrbit = START_ORBIT;
    el.fieldOfView = "auto";
    el.resetTurntableRotation(0);
    el.jumpCameraToGoal();
  }
  function toggleSpin() {
    if (!ref.current) return;
    ref.current.autoRotate = !spinning;
    setSpinning(!spinning);
  }

  return (
    <figure className={cn("space-y-2", className)} data-testid="model-viewer">
      <div className="bg-blueprint relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-2" dir="ltr">
        {mounted ? (
          <model-viewer
            ref={ref}
            src={src}
            alt={t("label", { name })}
            camera-controls=""
            auto-rotate=""
            rotation-per-second="18deg"
            disable-pan=""
            touch-action="pan-y"
            interaction-prompt="none"
            shadow-intensity="0.8"
            exposure="1.05"
            camera-orbit={START_ORBIT}
            min-camera-orbit="auto auto 40%"
            max-camera-orbit="auto auto 250%"
            className="size-full focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
            style={{ display: "block", width: "100%", height: "100%", background: "transparent" }}
            aria-describedby={hintId}
          />
        ) : null}
        {state !== "ready" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center" dir="auto">
            <CubeIcon size={48} className="text-primary-text" />
            {state === "error" ? (
              <>
                <p role="alert" className="max-w-xs text-sm text-danger">{t("error")}</p>
                <Button variant="secondary" onClick={load}>{t("retry")}</Button>
              </>
            ) : state === "loading" ? (
              <p role="status" aria-live="polite" className="text-sm font-medium">
                {t("loading", { percent: progress })}
              </p>
            ) : (
              <>
                <Button onClick={load}>{t("load")}</Button>
                <p className="max-w-xs text-xs text-muted">{t("loadNote")}</p>
              </>
            )}
          </div>
        ) : null}
      </div>
      {state === "ready" ? (
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("controls")}>
          <Button variant="secondary" size="sm" onClick={() => zoom(1)} aria-label={t("zoomIn")}>+</Button>
          <Button variant="secondary" size="sm" onClick={() => zoom(-1)} aria-label={t("zoomOut")}>−</Button>
          <Button variant="secondary" size="sm" onClick={toggleSpin} aria-pressed={spinning}>{spinning ? t("pause") : t("spin")}</Button>
          <Button variant="ghost" size="sm" onClick={reset}>{t("reset")}</Button>
        </div>
      ) : null}
      <figcaption id={hintId} className="text-xs text-muted">{t("hint")}</figcaption>
    </figure>
  );
}
