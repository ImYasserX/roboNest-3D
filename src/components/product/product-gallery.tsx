"use client";

import Image from "next/image";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CubeIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { ModelViewer } from "./model-viewer";

type GalleryImage = { src: string; alt: string; width: number | null; height: number | null };

export function ProductGallery({ images, name, preview }: { images: GalleryImage[]; name: string; preview: { src: string } | null }) {
  const t = useTranslations("product");
  const slides = images.length + (preview ? 1 : 0);
  const [index, setIndex] = useState(0);
  const showingPreview = preview !== null && (index === images.length || images.length === 0);
  const current = images[index];

  return (
    <section aria-label={t("gallery")} className="space-y-3">
      <div className="relative">
        {showingPreview ? (
          <ModelViewer src={preview.src} name={name} />
        ) : current ? (
          <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-2">
            <Image
              src={current.src}
              alt={current.alt}
              fill
              priority={index === 0}
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="object-cover"
            />
          </div>
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-xl border border-border bg-surface-2 text-muted">
            <CubeIcon size={64} />
            <span className="sr-only">{t("noImage")}</span>
          </div>
        )}
        {slides > 1 ? (
          <p className="sr-only" aria-live="polite">
            {t("imageOf", { index: index + 1, total: slides })}
          </p>
        ) : null}
      </div>
      {slides > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <li key={img.src} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-pressed={index === i}
                aria-label={t("showImage", { index: i + 1 })}
                className={cn("relative block size-18 overflow-hidden rounded-lg border-2 bg-surface-2 sm:size-20", index === i ? "border-primary" : "border-border hover:border-border-strong")}
              >
                <Image src={img.src} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
          {preview ? (
            <li className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(images.length)}
                aria-pressed={showingPreview}
                className={cn("flex size-18 flex-col items-center justify-center gap-1 rounded-lg border-2 bg-surface-2 text-xs font-semibold sm:size-20", showingPreview ? "border-primary" : "border-border hover:border-border-strong")}
              >
                <CubeIcon size={22} className="text-primary-text" />
                {t("view3d")}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
